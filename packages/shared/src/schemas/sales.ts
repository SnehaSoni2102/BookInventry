import { z } from 'zod';
import { PaymentMethod, SaleStatus } from '../enums';
import { paginationQuerySchema } from './common';

export const createSaleBodySchema = z.object({
  items: z
    .array(
      z.object({
        copyId: z.string().uuid(),
        /** Only an admin may differ from the copy's selling price (D7). */
        soldPriceMinor: z.number().int().min(0).max(100_000_00).optional(),
      }),
    )
    .min(1)
    .max(100),
  paymentMethod: PaymentMethod.schema,
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(1000).optional(),
  clientRef: z.string().uuid(),
  /** Admin selling a copy that is out at a stall must confirm (D8). */
  confirmAtStallCopies: z.boolean().optional(),
});
export type CreateSaleBody = z.infer<typeof createSaleBodySchema>;

const dateish = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

export const listSalesQuerySchema = paginationQuerySchema.extend({
  stallId: z.string().uuid().optional(),
  /** `true` = only central sales (shown as "Admin"). */
  central: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sellerId: z.string().uuid().optional(),
  from: dateish.optional(),
  to: dateish.optional(),
  paymentMethod: PaymentMethod.schema.optional(),
  status: SaleStatus.schema.optional(),
  /** receipt number, copy code or title */
  q: z.string().trim().max(200).optional(),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

export const voidSaleBodySchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500),
  /** Put the books back AT the stall (it must still be active) instead of on the central shelf. */
  returnToStall: z.boolean().default(false),
});
export type VoidSaleBody = z.infer<typeof voidSaleBodySchema>;

export const salesSummaryQuerySchema = z.object({
  from: dateish.optional(),
  to: dateish.optional(),
  groupBy: z.enum(['stall', 'day', 'paymentMethod', 'genre']).default('stall'),
});
export type SalesSummaryQuery = z.infer<typeof salesSummaryQuerySchema>;

export const receiptQuerySchema = z.object({ format: z.enum(['thermal', 'a6']).default('thermal') });

export interface SaleItemDto {
  copyId: string;
  code: string;
  title: string;
  condition: string;
  listPriceMinor: number;
  soldPriceMinor: number;
}

export interface SaleListItem {
  id: string;
  receiptNo: string;
  soldAt: string;
  stallId: string | null;
  /** "Admin", "Admin @ {stall}" or the stall name. */
  soldAtLabel: string;
  seller: { id: string; displayName: string };
  itemsCount: number;
  totalMinor: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
}

export interface SaleDto extends SaleListItem {
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  items: SaleItemDto[];
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
}

export interface VoidSaleResponse {
  sale: SaleDto;
  restored: Array<{ code: string; title: string; locationCode: string | null; relocated: boolean }>;
  /** Copies that got a new location and need a fresh label. */
  labelPdfUrl: string | null;
}

export interface SummaryRow {
  key: string;
  label: string;
  salesCount: number;
  itemsCount: number;
  revenueMinor: number;
  byPaymentMethod: Record<PaymentMethod, number>;
}

export interface SalesSummary {
  groupBy: 'stall' | 'day' | 'paymentMethod' | 'genre';
  rows: SummaryRow[];
  total: SummaryRow;
}
