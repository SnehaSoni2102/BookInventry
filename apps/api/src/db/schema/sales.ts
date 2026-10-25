import { desc, sql } from 'drizzle-orm';
import {
  check, index, integer, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { copies } from './copies.js';
import { paymentMethod, saleStatus } from './enums.js';
import { stalls } from './stalls.js';
import { users } from './users.js';

export const sales = pgTable(
  'sales',
  {
    id: uuid().primaryKey().defaultRandom(),
    receiptNo: text().notNull().unique(),
    stallId: uuid().references(() => stalls.id),
    soldById: uuid().notNull().references(() => users.id),
    soldAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    paymentMethod: paymentMethod().notNull(),
    totalMinor: integer().notNull(),
    status: saleStatus().notNull().default('COMPLETED'),
    customerName: text(),
    customerPhone: text(),
    notes: text(),
    clientRef: uuid().unique(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedById: uuid().references(() => users.id),
    voidReason: text(),
  },
  (t) => [
    check('sales_total_nonneg', sql`${t.totalMinor} >= 0`),
    check('sales_voided_at', sql`(${t.status} = 'VOIDED') = (${t.voidedAt} IS NOT NULL)`),
    index('sales_stall_time_idx').on(t.stallId, desc(t.soldAt)),
    index('sales_seller_time_idx').on(t.soldById, desc(t.soldAt)),
    index('sales_status_time_idx').on(t.status, desc(t.soldAt)),
  ],
);

export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    saleId: uuid().notNull().references(() => sales.id, { onDelete: 'cascade' }),
    copyId: uuid().notNull().references(() => copies.id),
    listPriceMinor: integer().notNull(),
    soldPriceMinor: integer().notNull(),
  },
  (t) => [
    unique('sale_items_sale_id_copy_id_key').on(t.saleId, t.copyId),
    check('sale_items_list_nonneg', sql`${t.listPriceMinor} >= 0`),
    check('sale_items_sold_nonneg', sql`${t.soldPriceMinor} >= 0`),
    index('sale_items_copy_idx').on(t.copyId),
  ],
);
