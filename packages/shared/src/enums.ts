import { z } from 'zod';

function defineEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return { values, schema: z.enum(values) };
}

export const Role = defineEnum(['ADMIN', 'INVENTORY_STAFF', 'STALL_MANAGER']);
export type Role = (typeof Role.values)[number];

export const BookCondition = defineEnum(['NEW', 'LIKE_NEW', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR']);
export type BookCondition = (typeof BookCondition.values)[number];

export const CopyStatus = defineEnum(['IN_STOCK', 'AT_STALL', 'SOLD', 'WRITTEN_OFF']);
export type CopyStatus = (typeof CopyStatus.values)[number];

export const StallStatus = defineEnum(['PLANNED', 'ACTIVE', 'CLOSED']);
export type StallStatus = (typeof StallStatus.values)[number];

export const PaymentMethod = defineEnum(['CASH', 'UPI', 'CARD', 'OTHER']);
export type PaymentMethod = (typeof PaymentMethod.values)[number];

export const SaleStatus = defineEnum(['COMPLETED', 'VOIDED']);
export type SaleStatus = (typeof SaleStatus.values)[number];

export const MovementOutcome = defineEnum(['OPEN', 'RETURNED', 'SOLD', 'LOST']);
export type MovementOutcome = (typeof MovementOutcome.values)[number];

export const MetadataSource = defineEnum(['OPEN_LIBRARY', 'GOOGLE_BOOKS', 'MANUAL', 'IMPORT']);
export type MetadataSource = (typeof MetadataSource.values)[number];

export const WriteoffReason = defineEnum([
  'DAMAGED',
  'LOST',
  'DONATED_ONWARD',
  'RECYCLED',
  'OTHER',
]);
export type WriteoffReason = (typeof WriteoffReason.values)[number];

export const ImportStatus = defineEnum([
  'UPLOADED',
  'VALIDATING',
  'READY',
  'COMMITTING',
  'COMPLETED',
  'FAILED',
]);
export type ImportStatus = (typeof ImportStatus.values)[number];

export const ImportRowStatus = defineEnum(['VALID', 'WARNING', 'ERROR', 'COMMITTED', 'SKIPPED']);
export type ImportRowStatus = (typeof ImportRowStatus.values)[number];
