import { z } from 'zod';
import { paginationQuerySchema } from './common';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #4C6EF5');

export const createGenreBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, '2–4 letters'),
  color: hexColor.optional(),
  /** Defaults to the end of the shelf order. */
  sortOrder: z.number().int().min(1).optional(),
});
export type CreateGenreBody = z.infer<typeof createGenreBodySchema>;

export const updateGenreBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: hexColor,
    sortOrder: z.number().int().min(1),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateGenreBody = z.infer<typeof updateGenreBodySchema>;

export const putGenreKeywordsBodySchema = z.object({
  keywords: z
    .array(z.object({ keyword: z.string().trim().toLowerCase().min(1).max(60), weight: z.number().int().min(1).max(10).default(1) }))
    .max(200),
});
export type PutGenreKeywordsBody = z.infer<typeof putGenreKeywordsBodySchema>;

export const createRackBodySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}$/, '1–2 letters'),
  name: z.string().trim().max(80).optional(),
  sortOrder: z.number().int().min(1).optional(),
});
export type CreateRackBody = z.infer<typeof createRackBodySchema>;

export const updateRackBodySchema = z
  .object({ name: z.string().trim().max(80).nullable(), sortOrder: z.number().int().min(1) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateRackBody = z.infer<typeof updateRackBodySchema>;

export const createRowBodySchema = z.object({
  rackId: z.string().uuid(),
  rowNumber: z.number().int().min(1).max(99),
  capacity: z.number().int().min(1).max(999),
  genreId: z.string().uuid().nullable().optional(),
  isOverflow: z.boolean().optional(),
});
export type CreateRowBody = z.infer<typeof createRowBodySchema>;

export const bulkRowsBodySchema = z.object({
  count: z.number().int().min(1).max(99),
  capacity: z.number().int().min(1).max(999),
  genreId: z.string().uuid().nullable().optional(),
});
export type BulkRowsBody = z.infer<typeof bulkRowsBodySchema>;

export const updateRowBodySchema = z
  .object({
    capacity: z.number().int().min(1).max(999),
    genreId: z.string().uuid().nullable(),
    isOverflow: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateRowBody = z.infer<typeof updateRowBodySchema>;

export const rowSignsQuerySchema = z.object({
  rowIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).optional()),
});
export type RowSignsQuery = z.infer<typeof rowSignsQuerySchema>;

export const unshelvedQuerySchema = paginationQuerySchema;

export interface GenreDto {
  id: string;
  name: string;
  code: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  keywords?: { keyword: string; weight: number }[];
}

export interface RackDto {
  id: string;
  code: string;
  name: string | null;
  sortOrder: number;
}

export interface ShelfRowDto {
  id: string;
  rackId: string;
  rackCode: string;
  rowNumber: number;
  code: string;
  capacity: number;
  genreId: string | null;
  isOverflow: boolean;
  isActive: boolean;
}

export interface ShelfMapRow extends ShelfRowDto {
  genre: { id: string; name: string; code: string; color: string } | null;
  used: number;
  reservedAtStall: number;
  percentFull: number;
}

export interface ShelfMapRack extends RackDto {
  rows: ShelfMapRow[];
}

export interface RowSlot {
  slot: number;
  copy: { id: string; code: string; title: string; status: string } | null;
}

export interface Placement {
  rowId: string;
  slot: number;
  locationCode: string;
}
