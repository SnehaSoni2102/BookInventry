import { z } from 'zod';
import { paginationQuerySchema } from './common';

export const LabelTemplate = ['THERMAL_50x25', 'THERMAL_50x30_1D', 'A4_24'] as const;
export type LabelTemplate = (typeof LabelTemplate)[number];

const idList = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).min(1).max(500));

export const labelPdfQuerySchema = z
  .object({
    copyIds: idList.optional(),
    importJobId: z.string().uuid().optional(),
    template: z.enum(LabelTemplate).optional(),
    /** 1-based cell on the first A4 sheet, to reuse a partly used sheet. */
    startPosition: z.coerce.number().int().min(1).max(24).default(1),
  })
  .refine((v) => Boolean(v.copyIds) !== Boolean(v.importJobId), 'Provide copyIds or importJobId');
export type LabelPdfQuery = z.infer<typeof labelPdfQuerySchema>;

/** Same as the query form, but the ids travel in the body: 500 UUIDs overflow the URL/header limit. */
export const labelPdfBodySchema = z.object({
  copyIds: z.array(z.string().uuid()).min(1).max(500),
  template: z.enum(LabelTemplate).optional(),
  startPosition: z.number().int().min(1).max(24).default(1),
});
export type LabelPdfBody = z.infer<typeof labelPdfBodySchema>;

export const labelQueueQuerySchema = paginationQuerySchema.extend({
  createdBy: z.enum(['me']).optional(),
  importJobId: z.string().uuid().optional(),
});
export type LabelQueueQuery = z.infer<typeof labelQueueQuerySchema>;

export const markPrintedBodySchema = z.object({ copyIds: z.array(z.string().uuid()).min(1).max(500) });
export type MarkPrintedBody = z.infer<typeof markPrintedBodySchema>;

export interface LabelQueueItem {
  id: string;
  code: string;
  title: string;
  authors: string[];
  condition: string;
  sellingPriceMinor: number;
  locationCode: string | null;
  createdAt: string;
}
