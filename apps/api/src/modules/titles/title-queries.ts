import { eq } from 'drizzle-orm';
import type { TitleDto } from '@bookstall/shared';
import type { Q } from '../../db/client.js';
import { bookTitles, genres } from '../../db/schema/index.js';

export type { Q };
export type TitleRow = typeof bookTitles.$inferSelect;
export type GenreRow = typeof genres.$inferSelect;

export const selectTitles = (q: Q) =>
  q
    .select({ title: bookTitles, genre: genres })
    .from(bookTitles)
    .innerJoin(genres, eq(genres.id, bookTitles.genreId));

export function coverUrls(t: Pick<TitleRow, 'id' | 'coverKey' | 'updatedAt'>) {
  if (!t.coverKey) return { coverUrl: null, coverThumbUrl: null };
  const v = t.updatedAt.getTime();
  return {
    coverUrl: `/api/v1/files/covers/${t.id}/400.webp?v=${v}`,
    coverThumbUrl: `/api/v1/files/covers/${t.id}/160.webp?v=${v}`,
  };
}

export function toTitleDto(t: TitleRow, g: GenreRow): TitleDto {
  return {
    id: t.id,
    isbn13: t.isbn13,
    isbn10: t.isbn10,
    title: t.title,
    subtitle: t.subtitle,
    authors: t.authors,
    publisher: t.publisher,
    publishedYear: t.publishedYear,
    language: t.language,
    pageCount: t.pageCount,
    edition: t.edition,
    summary: t.summary,
    subjects: t.subjects,
    genre: { id: g.id, name: g.name, code: g.code, color: g.color },
    ...coverUrls(t),
    source: t.source,
    externalIds: (t.externalIds ?? {}) as Record<string, string>,
    version: t.version,
    createdAt: t.createdAt.toISOString(),
  };
}
