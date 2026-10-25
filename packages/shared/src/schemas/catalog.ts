import { z } from 'zod';
import { BookCondition } from '../enums';
import { cleanIsbn } from '../isbn';
import type { CopyGroup } from './titles';

export const lookupQuerySchema = z.object({ isbn: z.string().trim().transform(cleanIsbn) });
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  author: z.string().trim().max(200).optional(),
});
export const priceSuggestionQuerySchema = z.object({
  originalPriceMinor: z.coerce.number().int().min(0).max(100_000_00),
  condition: BookCondition.schema,
});

export interface CatalogMetadata {
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  summary: string | null;
  subjects: string[];
  coverUrl: string | null;
  externalIds: Record<string, string>;
}

export type CatalogSource = 'OPEN_LIBRARY' | 'GOOGLE_BOOKS' | 'LOCAL';

export interface CatalogLookupResult {
  inInventory: boolean;
  titleId?: string;
  copyGroups?: CopyGroup[];
  found: boolean;
  source?: CatalogSource;
  metadata?: CatalogMetadata;
  suggestedGenreId?: string;
  alternativeGenreIds?: string[];
  /** Providers that errored (as opposed to answering "not found"). Manual entry is always possible. */
  warnings?: Array<'EXTERNAL_LOOKUP_FAILED'>;
}

export interface CatalogSearchHit {
  source: CatalogSource;
  title: string;
  authors: string[];
  firstPublishYear: number | null;
  isbn13: string | null;
  coverUrl: string | null;
  titleId?: string;
}

export interface PriceSuggestion {
  suggestedMinor: number;
  percent: number;
  roundedToMinor: number;
}
