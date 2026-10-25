import { isValidIsbn10, isValidIsbn13, toIsbn13, type CatalogMetadata, type CatalogSearchHit } from '@bookstall/shared';
import { cleanSummary, dedupe, normalizeLanguage, yearFrom } from './text.js';
import { fetchJson, type ProviderGate } from './provider-gate.js';

const DEFAULT_BASE = 'https://www.googleapis.com/books/v1/volumes';

interface Volume {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
  };
}

/** Google returns http thumbnails with an `&edge=curl` page-curl effect; undo both. */
export function cleanGoogleCover(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/^http:/, 'https:').replace(/&edge=curl/g, '');
}

export function mapGoogleVolume(v: Volume, requestedIsbn13?: string): CatalogMetadata | null {
  const i = v.volumeInfo;
  if (!i?.title) return null;
  const ids = i.industryIdentifiers ?? [];
  const isbn13 = ids.find((x) => x.type === 'ISBN_13' && x.identifier && isValidIsbn13(x.identifier))?.identifier ?? requestedIsbn13 ?? null;
  const isbn10 = ids.find((x) => x.type === 'ISBN_10' && x.identifier && isValidIsbn10(x.identifier))?.identifier ?? null;
  return {
    isbn13,
    isbn10,
    title: i.title.trim(),
    subtitle: i.subtitle?.trim() || null,
    authors: dedupe(i.authors ?? [], 20),
    publisher: i.publisher?.trim() || null,
    publishedYear: yearFrom(i.publishedDate),
    language: normalizeLanguage(i.language),
    pageCount: i.pageCount && i.pageCount > 0 ? i.pageCount : null,
    summary: cleanSummary(i.description),
    // "Fiction / Literary" → ["Fiction / Literary", "Fiction", "Literary"] so keyword matching sees each part
    subjects: dedupe((i.categories ?? []).flatMap((c) => [c, ...c.split('/').map((p) => p.trim())])),
    coverUrl: cleanGoogleCover(i.imageLinks?.thumbnail ?? i.imageLinks?.smallThumbnail),
    externalIds: v.id ? { googleBooks: v.id } : {},
  };
}

export class GoogleBooksProvider {
  constructor(
    private readonly gate: ProviderGate,
    private readonly opts: { apiKey?: string; timeoutMs: number; baseUrl?: string },
  ) {}

  private get<T>(params: URLSearchParams) {
    if (this.opts.apiKey) params.set('key', this.opts.apiKey);
    return this.gate.run(() => fetchJson<T>(`${this.opts.baseUrl ?? DEFAULT_BASE}?${params}`, { timeoutMs: this.opts.timeoutMs }));
  }

  async lookupIsbn(isbn13: string): Promise<CatalogMetadata | null> {
    const data = await this.get<{ items?: Volume[] }>(new URLSearchParams({ q: `isbn:${isbn13}`, maxResults: '1' }));
    const first = data?.items?.[0];
    return first ? mapGoogleVolume(first, isbn13) : null;
  }

  async search(q: string, author?: string): Promise<CatalogSearchHit[]> {
    const query = author ? `intitle:${q}+inauthor:${author}` : `intitle:${q}`;
    const data = await this.get<{ items?: Volume[] }>(new URLSearchParams({ q: query, maxResults: '10' }));
    return (data?.items ?? [])
      .map((v) => ({ v, m: mapGoogleVolume(v) }))
      .filter((x): x is { v: Volume; m: CatalogMetadata } => Boolean(x.m))
      .map(({ m }) => ({
        source: 'GOOGLE_BOOKS' as const,
        title: m.title,
        authors: m.authors,
        firstPublishYear: m.publishedYear,
        isbn13: m.isbn13 ?? (m.isbn10 ? toIsbn13(m.isbn10) : null),
        coverUrl: m.coverUrl,
      }));
  }
}
