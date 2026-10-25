import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import {
  normalizeText, roundToStep, toIsbn13,
  type BookCondition, type CatalogLookupResult, type CatalogMetadata, type CatalogSearchHit, type PriceSuggestion,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles, externalLookupCache, genreKeywords, genres } from '../../db/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';
import { TitlesService } from '../titles/titles.service.js';
import { suggestGenre, type GenreWithKeywords } from './genre-suggest.js';
import { GoogleBooksProvider } from './googlebooks.provider.js';
import { mergeMetadata } from './merge.js';
import { OpenLibraryProvider } from './openlibrary.provider.js';
import { ProviderGate } from './provider-gate.js';

const HIT_TTL_MS = 30 * 86_400_000;
const MISS_TTL_MS = 7 * 86_400_000;

type ProviderName = 'openlibrary' | 'googlebooks';

@Injectable()
export class CatalogService {
  private readonly ol: OpenLibraryProvider;
  private readonly gb: GoogleBooksProvider;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TitlesService) private readonly titles: TitlesService,
  ) {
    const gate = (name: string) => new ProviderGate({ name, minIntervalMs: env.EXTERNAL_MIN_INTERVAL_MS });
    this.ol = new OpenLibraryProvider(gate('Open Library'), {
      userAgent: env.OPENLIBRARY_USER_AGENT,
      timeoutMs: env.EXTERNAL_LOOKUP_TIMEOUT_MS,
      baseUrl: env.OPENLIBRARY_BASE_URL,
    });
    this.gb = new GoogleBooksProvider(gate('Google Books'), {
      apiKey: env.GOOGLE_BOOKS_API_KEY,
      timeoutMs: env.EXTERNAL_LOOKUP_TIMEOUT_MS,
      baseUrl: env.GOOGLE_BOOKS_BASE_URL,
    });
  }

  // ── cache ──
  private async cached<T>(provider: ProviderName, key: string, load: () => Promise<T | null>): Promise<T | null> {
    const [hit] = await this.db
      .select()
      .from(externalLookupCache)
      .where(and(eq(externalLookupCache.provider, provider), eq(externalLookupCache.lookupKey, key)));
    if (hit) {
      const ttl = hit.payload === null ? MISS_TTL_MS : HIT_TTL_MS;
      if (Date.now() - hit.fetchedAt.getTime() < ttl) return hit.payload as T | null;
    }
    const fresh = await load(); // throws on provider failure: failures are never cached
    await this.db
      .insert(externalLookupCache)
      .values({ provider, lookupKey: key, payload: fresh as object | null })
      .onConflictDoUpdate({
        target: [externalLookupCache.provider, externalLookupCache.lookupKey],
        set: { payload: fresh as object | null, fetchedAt: new Date() },
      });
    return fresh;
  }

  // ── genre suggestion ──
  private async genresWithKeywords(): Promise<GenreWithKeywords[]> {
    const [gs, ks] = await Promise.all([
      this.db.select().from(genres).where(eq(genres.isActive, true)).orderBy(asc(genres.sortOrder)),
      this.db.select().from(genreKeywords),
    ]);
    return gs.map((g) => ({
      id: g.id, code: g.code, sortOrder: g.sortOrder,
      keywords: ks.filter((k) => k.genreId === g.id).map((k) => ({ keyword: k.keyword, weight: k.weight })),
    }));
  }

  // ── lookup ──
  async lookup(rawIsbn: string): Promise<CatalogLookupResult> {
    const isbn13 = toIsbn13(rawIsbn);
    if (!isbn13) throw new AppError('VALIDATION_FAILED', 'That is not a valid ISBN-10 or ISBN-13');

    // 1. local database
    const [local] = await this.db.select().from(bookTitles).where(eq(bookTitles.isbn13, isbn13));
    if (local) {
      const dto = await this.titles.getDto(this.db, local.id);
      return {
        inInventory: true,
        titleId: local.id,
        copyGroups: await this.titles.copyGroups(this.db, local.id),
        found: true,
        source: 'LOCAL',
        metadata: {
          isbn13: dto.isbn13, isbn10: dto.isbn10, title: dto.title, subtitle: dto.subtitle, authors: dto.authors,
          publisher: dto.publisher, publishedYear: dto.publishedYear, language: dto.language, pageCount: dto.pageCount,
          summary: dto.summary, subjects: dto.subjects, coverUrl: dto.coverUrl, externalIds: dto.externalIds,
        },
        suggestedGenreId: dto.genre.id,
      };
    }

    // 2–4. cache, then both providers in parallel
    const key = `isbn:${isbn13}`;
    const [olRes, gbRes] = await Promise.allSettled([
      this.cached<CatalogMetadata>('openlibrary', key, () => this.ol.lookupIsbn(isbn13)),
      this.cached<CatalogMetadata>('googlebooks', key, () => this.gb.lookupIsbn(isbn13)),
    ]);
    const olMeta = olRes.status === 'fulfilled' ? olRes.value : null;
    const gbMeta = gbRes.status === 'fulfilled' ? gbRes.value : null;
    const failed = olRes.status === 'rejected' || gbRes.status === 'rejected';

    const metadata = mergeMetadata(olMeta, gbMeta);
    if (!metadata) {
      return { inInventory: false, found: false, ...(failed ? { warnings: ['EXTERNAL_LOOKUP_FAILED' as const] } : {}) };
    }
    metadata.isbn13 ??= isbn13;
    const suggestion = suggestGenre(metadata.subjects, metadata.language, await this.genresWithKeywords());
    return {
      inInventory: false,
      found: true,
      source: olMeta ? 'OPEN_LIBRARY' : 'GOOGLE_BOOKS',
      metadata,
      ...suggestion,
      ...(failed ? { warnings: ['EXTERNAL_LOOKUP_FAILED' as const] } : {}),
    };
  }

  // ── search ──
  async search(q: string, author?: string): Promise<{ hits: CatalogSearchHit[]; warnings: string[] }> {
    const hits: CatalogSearchHit[] = [];
    const norm = normalizeText(q);
    const local = await this.db
      .select({ id: bookTitles.id, title: bookTitles.title, authors: bookTitles.authors, isbn13: bookTitles.isbn13, year: bookTitles.publishedYear })
      .from(bookTitles)
      .where(
        and(
          ilike(bookTitles.searchText, `%${norm.replace(/[%_\\]/g, '\\$&')}%`),
          author ? ilike(bookTitles.searchText, `%${normalizeText(author).replace(/[%_\\]/g, '\\$&')}%`) : undefined,
        ),
      )
      .orderBy(sql`similarity(${bookTitles.searchText}, ${norm}) DESC`)
      .limit(5);
    for (const l of local) {
      hits.push({ source: 'LOCAL', title: l.title, authors: l.authors, firstPublishYear: l.year, isbn13: l.isbn13, coverUrl: null, titleId: l.id });
    }

    const warnings: string[] = [];
    const key = `q:${norm}|${normalizeText(author ?? '')}`;
    let external: CatalogSearchHit[] = [];
    try {
      external = (await this.cached<CatalogSearchHit[]>('openlibrary', key, () => this.ol.search(q, author))) ?? [];
    } catch {
      warnings.push('EXTERNAL_LOOKUP_FAILED');
    }
    if (!external.length) {
      try {
        external = (await this.cached<CatalogSearchHit[]>('googlebooks', key, () => this.gb.search(q, author))) ?? [];
      } catch {
        if (!warnings.length) warnings.push('EXTERNAL_LOOKUP_FAILED');
      }
    }
    const seen = new Set(hits.map((h) => h.isbn13).filter(Boolean));
    for (const h of external) {
      if (h.isbn13 && seen.has(h.isbn13)) continue;
      hits.push(h);
    }
    return { hits, warnings };
  }

  // ── price suggestion ──
  async priceSuggestion(originalPriceMinor: number, condition: BookCondition): Promise<PriceSuggestion> {
    const percentByCondition = await this.settings.get<Record<string, number>>('pricing.conditionPercent');
    const step = await this.settings.get<number>('pricing.roundToMinor');
    const percent = percentByCondition[condition] ?? 0;
    const raw = (originalPriceMinor * percent) / 100;
    // Never suggest ₹0 for a book that has a price: floor at one rounding step.
    const suggestedMinor = originalPriceMinor > 0 ? Math.max(step, roundToStep(raw, step)) : 0;
    return { suggestedMinor, percent, roundedToMinor: step };
  }
}
