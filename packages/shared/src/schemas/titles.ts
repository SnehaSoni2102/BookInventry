import { z } from 'zod';
import { BookCondition, CopyStatus, MetadataSource } from '../enums';
import { cleanIsbn, isbn13To10, isValidIsbn10, isValidIsbn13, toIsbn13 } from '../isbn';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

const isbnField = z
  .string()
  .trim()
  .transform(cleanIsbn)
  .refine((v) => isValidIsbn13(v) || isValidIsbn10(v), 'Not a valid ISBN');

export const titleInputSchema = z
  .object({
    isbn13: isbnField.optional(),
    isbn10: isbnField.optional(),
    title: z.string().trim().min(1).max(500),
    subtitle: optionalText(500),
    authors: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    publisher: optionalText(200),
    publishedYear: z.number().int().min(1400).max(2100).optional(),
    language: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/).optional(),
    pageCount: z.number().int().positive().max(20000).optional(),
    edition: optionalText(100),
    summary: optionalText(4000),
    subjects: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    genreId: z.string().uuid(),
    coverUrl: z.string().url().max(2000).optional(),
    source: MetadataSource.schema.default('MANUAL'),
    externalIds: z.record(z.string(), z.string()).default({}),
  })
  .transform((t) => {
    // Normalise ISBNs so a title entered with either form lands on the same unique isbn13.
    const raw13 = t.isbn13 && isValidIsbn13(t.isbn13) ? t.isbn13 : undefined;
    const raw10 = t.isbn10 ?? (t.isbn13 && isValidIsbn10(t.isbn13) ? t.isbn13 : undefined);
    const isbn13 = raw13 ?? (raw10 ? (toIsbn13(raw10) ?? undefined) : undefined);
    const isbn10 = raw10 && isValidIsbn10(raw10) ? raw10 : isbn13 ? (isbn13To10(isbn13) ?? undefined) : undefined;
    return { ...t, isbn13, isbn10 };
  });
export type TitleInput = z.infer<typeof titleInputSchema>;

export const updateTitleBodySchema = z
  .object({
    version: z.number().int().min(0),
    title: z.string().trim().min(1).max(500),
    subtitle: z.string().trim().max(500).nullable(),
    authors: z.array(z.string().trim().min(1).max(200)).max(20),
    publisher: z.string().trim().max(200).nullable(),
    publishedYear: z.number().int().min(1400).max(2100).nullable(),
    language: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/).nullable(),
    pageCount: z.number().int().positive().max(20000).nullable(),
    edition: z.string().trim().max(100).nullable(),
    summary: z.string().trim().max(4000).nullable(),
    subjects: z.array(z.string().trim().min(1).max(100)).max(50),
    genreId: z.string().uuid(),
  })
  .partial()
  .required({ version: true })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type UpdateTitleBody = z.infer<typeof updateTitleBodySchema>;


export interface GenreRef {
  id: string;
  name: string;
  code: string;
  color: string;
}

export interface TitleDto {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  edition: string | null;
  summary: string | null;
  subjects: string[];
  genre: GenreRef;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  source: MetadataSource;
  externalIds: Record<string, string>;
  version: number;
  createdAt: string;
}

export interface CopyGroupCopy {
  id: string;
  code: string;
  locationCode: string | null;
  status: CopyStatus;
  stall: { id: string; name: string } | null;
  createdAt: string;
}

/** Copies of one title with the same condition, selling price and availability (status/stall). */
export interface CopyGroup {
  condition: BookCondition;
  sellingPriceMinor: number;
  originalPriceMinor: number | null;
  status: CopyStatus;
  stall: { id: string; name: string } | null;
  quantity: number;
  copies: CopyGroupCopy[];
}

export interface TitleDetail extends TitleDto {
  copyGroups: CopyGroup[];
}
