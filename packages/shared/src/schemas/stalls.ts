import { z } from 'zod';
import { BookCondition, MovementOutcome, PaymentMethod, StallStatus } from '../enums';
import { paginationQuerySchema } from './common';
import { usernameSchema } from './users';
import type { CreateUserResponse, UserDto } from './users';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const datesInOrder = (v: { startsOn?: string | null; endsOn?: string | null }) =>
  !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn;

export const createStallBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    location: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
    manager: z
      .union([
        z.object({ existingUserId: z.string().uuid() }),
        z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(100) }),
      ])
      .optional(),
  })
  .refine(datesInOrder, { message: 'endsOn must not be before startsOn', path: ['endsOn'] });
export type CreateStallBody = z.infer<typeof createStallBodySchema>;

export const updateStallBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    location: z.string().trim().max(200).nullable(),
    description: z.string().trim().max(2000).nullable(),
    startsOn: isoDate.nullable(),
    endsOn: isoDate.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine(datesInOrder, { message: 'endsOn must not be before startsOn', path: ['endsOn'] });
export type UpdateStallBody = z.infer<typeof updateStallBodySchema>;

export const assignManagerBodySchema = z.object({
  userId: z.string().uuid(),
  moveFromOtherStall: z.boolean().default(false),
});
export type AssignManagerBody = z.infer<typeof assignManagerBodySchema>;

export const listStallsQuerySchema = z.object({
  status: StallStatus.schema.optional(),
});
export type ListStallsQuery = z.infer<typeof listStallsQuerySchema>;

export const checkoutBodySchema = z
  .object({
    clientRef: z.string().uuid(),
    /** (A) explicit copies */
    copyIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    /** (B) "send N copies of X (Good, ₹100)": the system picks them, ordered by shelf location */
    groups: z
      .array(
        z.object({
          titleId: z.string().uuid(),
          condition: BookCondition.schema,
          sellingPriceMinor: z.number().int().min(0),
          quantity: z.number().int().min(1).max(500),
        }),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .refine((v) => Boolean(v.copyIds) !== Boolean(v.groups), 'Provide either copyIds or groups');
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export const checkinBodySchema = z
  .object({
    clientRef: z.string().uuid(),
    copyIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    codes: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}\d{7}$/)).min(1).max(500).optional(),
  })
  .refine((v) => Boolean(v.copyIds) !== Boolean(v.codes), 'Provide either copyIds or codes');
export type CheckinBody = z.infer<typeof checkinBodySchema>;

export const closeStallBodySchema = z.object({
  markRemainingAs: z.enum(['LOST', 'KEEP_OPEN']),
});
export type CloseStallBody = z.infer<typeof closeStallBodySchema>;

export const pickListQuerySchema = z.object({ batchId: z.string().uuid() });
export const movementsQuerySchema = paginationQuerySchema.extend({ outcome: MovementOutcome.schema.optional() });
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;

export interface StallManagerDto {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
}

export interface StallDto {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: StallStatus;
  activatedAt: string | null;
  closedAt: string | null;
  managers: StallManagerDto[];
  counts: { atStall: number; sold: number; revenueMinor: number };
}

export interface CreateStallResponse {
  stall: StallDto;
  /** Present when a new manager account was created: credentials are shown once. */
  manager?: CreateUserResponse;
}

export interface CheckedOutItem {
  copyId: string;
  code: string;
  locationCode: string | null;
  title: string;
}

export interface CheckoutFailure {
  copyId?: string;
  code?: string;
  group?: { titleId: string; condition: BookCondition; sellingPriceMinor: number; quantity: number };
  reason: 'NOT_FOUND' | 'COPY_NOT_AVAILABLE' | 'INSUFFICIENT_STOCK';
  /** for INSUFFICIENT_STOCK */
  available?: number;
}

export interface CheckoutResponse {
  batchId: string;
  checkedOut: CheckedOutItem[];
  failed: CheckoutFailure[];
}

export interface CheckinItem {
  copyId: string;
  code: string;
  title: string;
  fromStall: { id: string; name: string };
  returnToLocation: string | null;
  /** The reserved slot was gone, so a new one was allocated: tell the volunteer where to put it. */
  relocated: boolean;
}

export interface CheckinFailure {
  copyId?: string;
  code?: string;
  reason: 'NOT_FOUND' | 'NOT_AT_STALL';
}

export interface CheckinResponse {
  checkedIn: CheckinItem[];
  failed: CheckinFailure[];
}

export interface ReconciliationBook {
  copyId: string;
  code: string;
  title: string;
  locationCode: string | null;
  sellingPriceMinor: number;
}

export interface Reconciliation {
  stall: { id: string; name: string; status: StallStatus };
  sent: number;
  sold: number;
  returned: number;
  lost: number;
  stillOut: ReconciliationBook[];
  revenueMinor: number;
  salesCount: number;
  byPaymentMethod: Record<PaymentMethod, number>;
}

export interface MovementDto {
  id: string;
  batchId: string;
  copy: { id: string; code: string; title: string };
  checkedOutAt: string;
  checkedOutBy: string;
  checkedInAt: string | null;
  outcome: MovementOutcome;
}

export type { UserDto };
