import { z } from 'zod';
import { BookCondition } from '../enums';
import type { CopyDto } from './copies';
import { paginationQuerySchema } from './common';
import type { GenreRef } from './titles';

/** Accepts `?x=a&x=b`, `?x[]=a` and `?x=a,b`. */
const listOf = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
  }, z.array(inner).max(50).optional());

export const InventoryStatus = ['available', 'atStalls', 'all', 'sold', 'writtenOff'] as const;
export type InventoryStatus = (typeof InventoryStatus)[number];

const boolish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const common = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  genreId: listOf(z.string().uuid()),
  condition: listOf(BookCondition.schema),
  /** Prices are in minor units (paise). */
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  /** `available` = in stock at central (stall managers: at their stall). Ignored for managers. */
  status: z.enum(InventoryStatus).default('available'),
  /** Admin/staff only: restrict to copies currently at this stall. */
  stallId: z.string().uuid().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const listTitlesQuerySchema = common.extend({
  sort: z.enum(['relevance', 'title', 'author', 'price', 'newest', 'quantity']).optional(),
});
export type ListTitlesQuery = z.infer<typeof listTitlesQuerySchema>;

export const listCopiesQuerySchema = common.extend({
  sort: z.enum(['relevance', 'title', 'author', 'price', 'newest', 'code', 'location']).optional(),
  unshelved: boolish.optional(),
  labelPending: boolish.optional(),
});
export type ListCopiesQuery = z.infer<typeof listCopiesQuerySchema>;

export interface TitleListItem {
  id: string;
  title: string;
  authors: string[];
  genre: GenreRef;
  coverThumbUrl: string | null;
  isbn13: string | null;
  availableCount: number;
  minPriceMinor: number;
  maxPriceMinor: number;
  conditions: BookCondition[];
}

export interface CopyListItem extends CopyDto {
  title: string;
  authors: string[];
  genre: GenreRef;
  coverThumbUrl: string | null;
  stall: { id: string; name: string } | null;
}

export type ExactMatch =
  | { type: 'copy'; code: string; copyId: string }
  | { type: 'isbn'; isbn13: string; titleId: string };

export interface InventoryPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  /** A scanned/typed copy code or ISBN: the client can jump straight to it. */
  exactMatch?: ExactMatch;
  /** Stall managers without an active stall get an empty list and this flag. */
  noActiveStall?: boolean;
}
