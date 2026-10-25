import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stallStatus } from './enums.js';
import { users } from './users.js';

export const stalls = pgTable(
  'stalls',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    location: text(),
    description: text(),
    startsOn: date(),
    endsOn: date(),
    status: stallStatus().notNull().default('PLANNED'),
    activatedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check('stalls_dates_order', sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
    uniqueIndex('stalls_name_live_uq').on(sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const stallAssignments = pgTable(
  'stall_assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    stallId: uuid().notNull().references(() => stalls.id),
    userId: uuid().notNull().references(() => users.id),
    assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    unassignedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stall_assignments_one_active_per_user').on(t.userId).where(sql`${t.unassignedAt} IS NULL`),
    index('stall_assignments_stall_idx').on(t.stallId),
  ],
);
