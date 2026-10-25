import { z } from 'zod';
import { BookCondition, CopyStatus, WriteoffReason } from '../enums';
import { titleInputSchema, type TitleDto } from './titles';

export const copyFieldsSchema = z.object({
  condition: BookCondition.schema,
  conditionNotes: z.string().trim().max(500).optional(),
  originalPriceMinor: z.number().int().min(0).max(100_000_00).nullable().optional(),
  sellingPriceMinor: z.number().int().min(0).max(100_000_00),
  donorName: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CopyFields = z.infer<typeof copyFieldsSchema>;

export const createCopiesBodySchema = z
  .object({
    titleId: z.string().uuid().optional(),
    title: titleInputSchema.optional(),
    copy: copyFieldsSchema,
    quantity: z.number().int().min(1).max(200).default(1),
    clientRef: z.string().uuid(),
  })
  .refine((v) => Boolean(v.titleId) !== Boolean(v.title), 'Provide either titleId or title');
export type CreateCopiesBody = z.infer<typeof createCopiesBodySchema>;

export const updateCopyBodySchema = z
  .object({
    version: z.number().int().min(0),
    condition: BookCondition.schema,
    conditionNotes: z.string().trim().max(500).nullable(),
    originalPriceMinor: z.number().int().min(0).max(100_000_00).nullable(),
    sellingPriceMinor: z.number().int().min(0).max(100_000_00),
    donorName: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .partial()
  .required({ version: true })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type UpdateCopyBody = z.infer<typeof updateCopyBodySchema>;

export const writeOffBodySchema = z.object({
  reason: WriteoffReason.schema,
  notes: z.string().trim().max(1000).optional(),
});
export type WriteOffBody = z.infer<typeof writeOffBodySchema>;

export const moveCopyBodySchema = z.union([
  z.object({ auto: z.literal(true) }),
  z.object({ rowId: z.string().uuid(), slot: z.number().int().min(1).max(999) }),
]);
export type MoveCopyBody = z.infer<typeof moveCopyBodySchema>;


export type CopyWarning = 'NO_SHELF_SPACE' | 'TITLE_EXISTS_METADATA_IGNORED';

export interface CopyDto {
  id: string;
  code: string;
  titleId: string;
  condition: BookCondition;
  conditionNotes: string | null;
  originalPriceMinor: number | null;
  sellingPriceMinor: number;
  status: CopyStatus;
  locationCode: string | null;
  rowId: string | null;
  slotNumber: number | null;
  currentStallId: string | null;
  donorName: string | null;
  notes: string | null;
  labelNeedsPrint: boolean;
  labelPrintedAt: string | null;
  acquiredAt: string;
  soldAt: string | null;
  version: number;
  createdAt: string;
}

export interface CreateCopiesResponse {
  title: TitleDto;
  copies: CopyDto[];
  warnings: CopyWarning[];
  labelPdfUrl: string;
}

export interface MovementHistoryItem {
  id: string;
  stall: { id: string; name: string };
  checkedOutAt: string;
  checkedInAt: string | null;
  outcome: string;
}

export interface CopyDetail extends CopyDto {
  title: TitleDto;
  stall: { id: string; name: string } | null;
  openMovement: { id: string; stallId: string; checkedOutAt: string; checkedOutBy: string } | null;
  sale: { saleId: string; receiptNo: string; soldPriceMinor: number; soldAt: string } | null;
  movements: MovementHistoryItem[];
}

export interface MoveListItem {
  code: string;
  from: string | null;
  to: string | null;
}
