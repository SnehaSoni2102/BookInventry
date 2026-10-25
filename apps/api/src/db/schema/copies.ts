import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { bookCondition, copyStatus, movementOutcome, writeoffReason } from './enums.js';
import { shelfRows } from './shelves.js';
import { stalls } from './stalls.js';
import { bookTitles } from './titles.js';
import { users } from './users.js';

export const copies = pgTable(
  'copies',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    titleId: uuid().notNull().references(() => bookTitles.id),
    condition: bookCondition().notNull(),
    conditionNotes: text(),
    originalPriceMinor: integer(),
    sellingPriceMinor: integer().notNull(),
    status: copyStatus().notNull().default('IN_STOCK'),
    rowId: uuid().references(() => shelfRows.id),
    slotNumber: integer(),
    lastLocationCode: text(),
    currentStallId: uuid().references(() => stalls.id),
    writeoffReason: writeoffReason(),
    donorName: text(),
    acquiredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    labelPrintedAt: timestamp({ withTimezone: true }),
    labelNeedsPrint: boolean().notNull().default(true),
    notes: text(),
    soldAt: timestamp({ withTimezone: true }),
    createdById: uuid().notNull().references(() => users.id),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check('copies_code_format', sql`${t.code} ~ '^[A-Z]{2,4}[0-9]{7}$'`),
    check('copies_original_price_nonneg', sql`${t.originalPriceMinor} >= 0`),
    check('copies_selling_price_nonneg', sql`${t.sellingPriceMinor} >= 0`),
    check('copies_slot_positive', sql`${t.slotNumber} >= 1`),
    check('copies_slot_pair', sql`(${t.rowId} IS NULL) = (${t.slotNumber} IS NULL)`),
    check('copies_stall_status', sql`(${t.status} = 'AT_STALL') = (${t.currentStallId} IS NOT NULL)`),
    check('copies_slot_released', sql`${t.status} IN ('IN_STOCK','AT_STALL') OR ${t.rowId} IS NULL`),
    check('copies_sold_at', sql`(${t.status} = 'SOLD') = (${t.soldAt} IS NOT NULL)`),
    check('copies_writeoff', sql`(${t.status} = 'WRITTEN_OFF') = (${t.writeoffReason} IS NOT NULL)`),
    unique('copies_unique_slot').on(t.rowId, t.slotNumber),
    index('copies_title_status_idx').on(t.titleId, t.status),
    index('copies_stall_status_idx').on(t.currentStallId, t.status),
    index('copies_status_price_idx').on(t.status, t.sellingPriceMinor),
    index('copies_label_queue_idx').on(t.labelNeedsPrint).where(sql`${t.labelNeedsPrint}`),
    index('copies_unshelved_idx').on(t.status).where(sql`${t.rowId} IS NULL AND ${t.status} = 'IN_STOCK'`),
  ],
);

export const stallMovements = pgTable(
  'stall_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    copyId: uuid().notNull().references(() => copies.id),
    stallId: uuid().notNull().references(() => stalls.id),
    batchId: uuid().notNull(),
    checkedOutAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    checkedOutById: uuid().notNull().references(() => users.id),
    checkedInAt: timestamp({ withTimezone: true }),
    checkedInById: uuid().references(() => users.id),
    outcome: movementOutcome().notNull().default('OPEN'),
  },
  (t) => [
    check('stall_movements_returned_checkin', sql`(${t.outcome} = 'RETURNED') = (${t.checkedInAt} IS NOT NULL)`),
    uniqueIndex('stall_movements_one_open_per_copy').on(t.copyId).where(sql`${t.outcome} = 'OPEN'`),
    index('stall_movements_stall_idx').on(t.stallId, t.outcome),
    index('stall_movements_batch_idx').on(t.batchId),
  ],
);
