import { z } from 'zod';
import { ImportRowStatus, ImportStatus } from '../enums';
import { paginationQuerySchema } from './common';

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Canonical column keys of the Excel template, in column order. */
export const IMPORT_COLUMNS = [
  'isbn', 'title', 'authors', 'genre', 'condition', 'original_price', 'selling_price', 'quantity',
  'publisher', 'published_year', 'language', 'summary', 'cover_url', 'donor', 'notes',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const listImportRowsQuerySchema = paginationQuerySchema.extend({ status: ImportRowStatus.schema.optional() });
export type ListImportRowsQuery = z.infer<typeof listImportRowsQuerySchema>;

export const listImportsQuerySchema = paginationQuerySchema;

export const commitImportBodySchema = z.object({ skipErrors: z.boolean().default(false) }).default({ skipErrors: false });
export type CommitImportBody = z.infer<typeof commitImportBodySchema>;

/** Edits are applied to the row's raw cells (as text) and the row is validated again. */
export const patchImportRowBodySchema = z.object({
  fields: z
    .partialRecord(z.enum(IMPORT_COLUMNS), z.union([z.string().max(5000), z.number(), z.null()]))
    .refine((f) => Object.keys(f).length > 0, 'Nothing to change'),
});
export type PatchImportRowBody = z.infer<typeof patchImportRowBodySchema>;

export interface ImportMessage {
  level: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ImportJobDto {
  id: string;
  originalName: string;
  status: ImportStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  copiesCreated: number;
  processedRows: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRowDto {
  id: string;
  rowNumber: number;
  status: ImportRowStatus;
  raw: Record<string, string>;
  messages: ImportMessage[];
  /** What will be created: present for VALID/WARNING/COMMITTED rows. */
  preview: {
    title: string;
    authors: string[];
    genreId: string | null;
    condition: string;
    sellingPriceMinor: number;
    quantity: number;
    existingTitle: boolean;
    lookup: 'LOCAL' | 'OPEN_LIBRARY' | 'GOOGLE_BOOKS' | 'NONE';
  } | null;
  createdCopyIds: string[];
}
