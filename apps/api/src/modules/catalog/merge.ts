import { isValidIsbn13, toIsbn13, type CatalogMetadata } from '@bookstall/shared';
import { dedupe } from './text.js';

/**
 * Open Library wins for title/authors/publisher/year/pages; Google Books wins for the description and
 * categories (subjects from both are kept, Google's first). Missing fields fall back to the other side.
 * The first cover that exists is used.
 */
export function mergeMetadata(ol: CatalogMetadata | null, gb: CatalogMetadata | null): CatalogMetadata | null {
  if (!ol && !gb) return null;
  if (!ol) return gb;
  if (!gb) return ol;
  const isbn13 = [ol.isbn13, gb.isbn13, ol.isbn10 && toIsbn13(ol.isbn10), gb.isbn10 && toIsbn13(gb.isbn10)].find(
    (v): v is string => Boolean(v) && isValidIsbn13(v as string),
  );
  return {
    isbn13: isbn13 ?? null,
    isbn10: ol.isbn10 ?? gb.isbn10,
    title: ol.title || gb.title,
    subtitle: ol.subtitle ?? gb.subtitle,
    authors: ol.authors.length ? ol.authors : gb.authors,
    publisher: ol.publisher ?? gb.publisher,
    publishedYear: ol.publishedYear ?? gb.publishedYear,
    language: ol.language ?? gb.language,
    pageCount: ol.pageCount ?? gb.pageCount,
    summary: gb.summary ?? ol.summary,
    subjects: dedupe([...gb.subjects, ...ol.subjects], 40),
    coverUrl: ol.coverUrl ?? gb.coverUrl,
    externalIds: { ...gb.externalIds, ...ol.externalIds },
  };
}
