import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  normalizeText, parseScan,
  type BookCondition, type CopyListItem, type ExactMatch, type InventoryPage, type ListCopiesQuery, type ListTitlesQuery,
  type TitleListItem,
} from '@bookstall/shared';
import type { AuthUser } from '../../common/decorators/index.js';
import { ScopeService, type Scope } from '../../common/scope.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles, copies, genres, racks, shelfRows, stalls } from '../../db/schema/index.js';
import { selectCopies, toCopyDto } from '../copies/copy-queries.js';
import { coverUrls } from '../titles/title-queries.js';

type Common = Pick<ListTitlesQuery, 'q' | 'genreId' | 'condition' | 'minPrice' | 'maxPrice' | 'status' | 'stallId'>;

const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&');

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ScopeService) private readonly scope: ScopeService,
  ) {}

  // ── predicates ──

  /** Which copies count, by role. Managers are always pinned to AT_STALL at their own stall. */
  private copyScope(scope: Scope, q: Common): SQL | undefined {
    if (scope.kind === 'stall') {
      return scope.stallId ? and(eq(copies.status, 'AT_STALL'), eq(copies.currentStallId, scope.stallId)) : sql`false`;
    }
    const byStall = q.stallId ? eq(copies.currentStallId, q.stallId) : undefined;
    switch (q.status) {
      case 'available':
        // a stall filter on the default view means "what is at that stall"
        return q.stallId ? and(eq(copies.status, 'AT_STALL'), byStall) : eq(copies.status, 'IN_STOCK');
      case 'atStalls':
        return and(eq(copies.status, 'AT_STALL'), byStall);
      case 'all':
        return and(inArray(copies.status, ['IN_STOCK', 'AT_STALL']), byStall);
      case 'sold':
        return and(eq(copies.status, 'SOLD'), byStall);
      case 'writtenOff':
        return and(eq(copies.status, 'WRITTEN_OFF'), byStall);
    }
  }

  private copyFilters(scope: Scope, q: Common): SQL | undefined {
    return and(
      this.copyScope(scope, q),
      q.condition?.length ? inArray(copies.condition, q.condition) : undefined,
      q.minPrice !== undefined ? sql`${copies.sellingPriceMinor} >= ${q.minPrice}` : undefined,
      q.maxPrice !== undefined ? sql`${copies.sellingPriceMinor} <= ${q.maxPrice}` : undefined,
    );
  }

  /** Text search over title/subtitle/authors/ISBN: every word must appear, or the whole string is trigram-similar. */
  private textMatch(norm: string): { where: SQL; rank: SQL } {
    const tokens = norm.split(' ').filter(Boolean);
    const allTokens = and(...tokens.map((t) => ilike(bookTitles.searchText, `%${escapeLike(t)}%`)));
    const rank = sql<number>`similarity(${bookTitles.searchText}, ${norm})`;
    return { where: or(allTokens, sql`${rank} > 0.25`)!, rank };
  }

  /** A pasted copy code or ISBN short-circuits to an exact match (01-DATABASE §5). */
  private parseQuery(q?: string) {
    const raw = q?.trim();
    if (!raw) return { kind: 'none' as const };
    const parsed = parseScan(raw);
    if (parsed.kind === 'copy') return { kind: 'copy' as const, code: parsed.code };
    if (parsed.kind === 'isbn') return { kind: 'isbn' as const, isbn13: parsed.isbn13 };
    const norm = normalizeText(raw);
    return norm ? { kind: 'text' as const, norm } : { kind: 'nothing' as const };
  }

  private async resolveScope(user: AuthUser): Promise<Scope> {
    return this.scope.resolve(user);
  }

  // ── titles ──

  async listTitles(user: AuthUser, q: ListTitlesQuery): Promise<InventoryPage<TitleListItem>> {
    const scope = await this.resolveScope(user);
    const empty = { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
    if (scope.kind === 'stall' && !scope.stallId) return { ...empty, noActiveStall: true };

    const parsed = this.parseQuery(q.q);
    if (parsed.kind === 'nothing') return empty;
    const text = parsed.kind === 'text' ? this.textMatch(parsed.norm) : undefined;

    let exactMatch: ExactMatch | undefined;
    let titleWhere: SQL | undefined;
    let copyWhere = this.copyFilters(scope, q);
    if (parsed.kind === 'copy') {
      copyWhere = and(copyWhere, eq(copies.code, parsed.code));
      const [hit] = await this.db.select({ id: copies.id }).from(copies).where(and(this.copyScope(scope, { ...q, status: 'all' }), eq(copies.code, parsed.code)));
      if (hit) exactMatch = { type: 'copy', code: parsed.code, copyId: hit.id };
    } else if (parsed.kind === 'isbn') {
      titleWhere = eq(bookTitles.isbn13, parsed.isbn13);
    } else if (text) {
      titleWhere = text.where;
    }
    const where = and(titleWhere, q.genreId?.length ? inArray(bookTitles.genreId, q.genreId) : undefined);

    const availableCount = sql<number>`count(${copies.id})::int`;
    const minPrice = sql<number>`min(${copies.sellingPriceMinor})::int`;
    const maxPrice = sql<number>`max(${copies.sellingPriceMinor})::int`;
    const direction = (dflt: 'asc' | 'desc') => ((q.order ?? dflt) === 'asc' ? asc : desc);
    const sort = q.sort ?? (text ? 'relevance' : 'title');
    const orderBy = [
      sort === 'relevance' && text ? direction('desc')(text.rank)
        : sort === 'author' ? direction('asc')(bookTitles.authorSort)
        : sort === 'price' ? direction('asc')(minPrice)
        : sort === 'newest' ? direction('desc')(sql`max(${copies.createdAt})`)
        : sort === 'quantity' ? direction('desc')(availableCount)
        : direction('asc')(bookTitles.titleSort),
      asc(bookTitles.titleSort),
      asc(bookTitles.id),
    ];

    // Drizzle builders mutate on every call, so build a fresh one per statement (the count must not see LIMIT).
    const base = () => this.db
      .select({
        title: bookTitles,
        genre: genres,
        availableCount, minPrice, maxPrice,
        conditions: sql<string[]>`array_agg(DISTINCT ${copies.condition}::text)`,
      })
      .from(bookTitles)
      .innerJoin(genres, eq(genres.id, bookTitles.genreId))
      .innerJoin(copies, and(eq(copies.titleId, bookTitles.id), copyWhere))
      .where(where)
      .groupBy(bookTitles.id, genres.id);

    const [rows, total] = await Promise.all([
      base().orderBy(...orderBy).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.$count(base().as('matches')),
    ]);

    if (!exactMatch && parsed.kind === 'isbn' && rows[0]) {
      exactMatch = { type: 'isbn', isbn13: parsed.isbn13, titleId: rows[0].title.id };
    }
    return {
      items: rows.map((r) => ({
        id: r.title.id,
        title: r.title.title,
        authors: r.title.authors,
        genre: { id: r.genre.id, name: r.genre.name, code: r.genre.code, color: r.genre.color },
        coverThumbUrl: coverUrls(r.title).coverThumbUrl,
        isbn13: r.title.isbn13,
        availableCount: r.availableCount,
        minPriceMinor: r.minPrice,
        maxPriceMinor: r.maxPrice,
        conditions: r.conditions as BookCondition[],
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      ...(exactMatch ? { exactMatch } : {}),
    };
  }

  // ── copies ──

  async listCopies(user: AuthUser, q: ListCopiesQuery): Promise<InventoryPage<CopyListItem>> {
    const scope = await this.resolveScope(user);
    const empty = { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
    if (scope.kind === 'stall' && !scope.stallId) return { ...empty, noActiveStall: true };

    const parsed = this.parseQuery(q.q);
    if (parsed.kind === 'nothing') return empty;
    const text = parsed.kind === 'text' ? this.textMatch(parsed.norm) : undefined;
    const codeOrder = asc(copies.code);

    const extra: Array<SQL | undefined> = [
      parsed.kind === 'copy' ? eq(copies.code, parsed.code) : undefined,
      parsed.kind === 'isbn' ? eq(bookTitles.isbn13, parsed.isbn13) : undefined,
      text?.where,
      q.genreId?.length ? inArray(bookTitles.genreId, q.genreId) : undefined,
      scope.kind === 'all' && q.unshelved ? and(sql`${copies.rowId} IS NULL`, eq(copies.status, 'IN_STOCK')) : undefined,
      scope.kind === 'all' && q.labelPending ? eq(copies.labelNeedsPrint, true) : undefined,
    ];
    const where = and(this.copyFilters(scope, q), ...extra);

    const direction = (dflt: 'asc' | 'desc') => ((q.order ?? dflt) === 'asc' ? asc : desc);
    const dir = (dflt: 'asc' | 'desc') => sql.raw(q.order ?? dflt);
    const sort = q.sort ?? (text ? 'relevance' : 'title');
    const orderBy = [
      sort === 'relevance' && text ? direction('desc')(text.rank)
        : sort === 'author' ? direction('asc')(bookTitles.authorSort)
        : sort === 'price' ? direction('asc')(copies.sellingPriceMinor)
        : sort === 'newest' ? direction('desc')(copies.createdAt)
        : sort === 'code' ? direction('asc')(copies.code)
        : sort === 'location' ? sql`${racks.sortOrder} ${dir('asc')} NULLS LAST`
        : direction('asc')(bookTitles.titleSort),
      ...(sort === 'location'
        ? [sql`${shelfRows.rowNumber} ${dir('asc')} NULLS LAST`, sql`${copies.slotNumber} ${dir('asc')} NULLS LAST`]
        : []),
      codeOrder,
    ];

    const [rows, [{ n } = { n: 0 }]] = await Promise.all([
      selectCopies(this.db)
        .where(where)
        .orderBy(...orderBy)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize)
        .then(async (rs) => {
          const titles = rs.length
            ? await this.db.select().from(bookTitles).innerJoin(genres, eq(genres.id, bookTitles.genreId))
                .where(inArray(bookTitles.id, [...new Set(rs.map((r) => r.copy.titleId))]))
            : [];
          const stallIds = [...new Set(rs.map((r) => r.copy.currentStallId).filter((x): x is string => Boolean(x)))];
          const stallRows = stallIds.length ? await this.db.select({ id: stalls.id, name: stalls.name }).from(stalls).where(inArray(stalls.id, stallIds)) : [];
          return rs.map((r) => ({
            r,
            t: titles.find((x) => x.book_titles.id === r.copy.titleId)!,
            stall: stallRows.find((s) => s.id === r.copy.currentStallId),
          }));
        }),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(copies)
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .where(where),
    ]);

    let exactMatch: ExactMatch | undefined;
    if (parsed.kind === 'copy' && rows[0]) exactMatch = { type: 'copy', code: parsed.code, copyId: rows[0].r.copy.id };
    return {
      items: rows.map(({ r, t, stall }) => ({
        ...toCopyDto(r),
        title: t.book_titles.title,
        authors: t.book_titles.authors,
        genre: { id: t.genres.id, name: t.genres.name, code: t.genres.code, color: t.genres.color },
        coverThumbUrl: coverUrls(t.book_titles).coverThumbUrl,
        stall: stall ? { id: stall.id, name: stall.name } : null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total: n,
      ...(exactMatch ? { exactMatch } : {}),
    };
  }
}
