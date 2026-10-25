import { desc } from 'drizzle-orm';
import {
  bigserial, index, inet, jsonb, pgTable, primaryKey, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    actorId: uuid().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_time_idx').on(desc(t.createdAt)),
  ],
);

export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const externalLookupCache = pgTable(
  'external_lookup_cache',
  {
    provider: text().notNull(),
    lookupKey: text().notNull(),
    payload: jsonb(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.lookupKey] })],
);

/** Replays the stored response when a client retries a mutation with the same `clientRef`. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text().notNull(),
    key: uuid().notNull(),
    userId: uuid().references(() => users.id),
    response: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);
