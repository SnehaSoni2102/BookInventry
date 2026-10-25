import { pgEnum, pgSequence } from 'drizzle-orm/pg-core';
import {
  BookCondition, ImportRowStatus, ImportStatus, MetadataSource, MovementOutcome, PaymentMethod,
  Role, SaleStatus, StallStatus, CopyStatus, WriteoffReason,
} from '@bookstall/shared';

export const userRole = pgEnum('user_role', Role.values);
export const bookCondition = pgEnum('book_condition', BookCondition.values);
export const copyStatus = pgEnum('copy_status', CopyStatus.values);
export const metadataSource = pgEnum('metadata_source', MetadataSource.values);
export const stallStatus = pgEnum('stall_status', StallStatus.values);
export const movementOutcome = pgEnum('movement_outcome', MovementOutcome.values);
export const paymentMethod = pgEnum('payment_method', PaymentMethod.values);
export const saleStatus = pgEnum('sale_status', SaleStatus.values);
export const importStatus = pgEnum('import_status', ImportStatus.values);
export const importRowStatus = pgEnum('import_row_status', ImportRowStatus.values);
export const writeoffReason = pgEnum('writeoff_reason', WriteoffReason.values);

export const copyCodeSeq = pgSequence('copy_code_seq', { startWith: 1 });
export const receiptSeq = pgSequence('receipt_seq', { startWith: 1 });
