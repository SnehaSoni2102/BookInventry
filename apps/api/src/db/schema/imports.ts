import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { importRowStatus, importStatus } from './enums.js';
import { users } from './users.js';

export const importJobs = pgTable('import_jobs', {
  id: uuid().primaryKey().defaultRandom(),
  fileKey: text().notNull(),
  originalName: text().notNull(),
  status: importStatus().notNull().default('UPLOADED'),
  totalRows: integer().notNull().default(0),
  validRows: integer().notNull().default(0),
  warningRows: integer().notNull().default(0),
  errorRows: integer().notNull().default(0),
  copiesCreated: integer().notNull().default(0),
  errorMessage: text(),
  createdById: uuid().notNull().references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp({ withTimezone: true }),
});

export const importRows = pgTable(
  'import_rows',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid().notNull().references(() => importJobs.id, { onDelete: 'cascade' }),
    rowNumber: integer().notNull(),
    raw: jsonb().notNull(),
    normalized: jsonb(),
    messages: jsonb().notNull().default([]),
    status: importRowStatus().notNull(),
    createdCopyIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [unique('import_rows_job_id_row_number_key').on(t.jobId, t.rowNumber)],
);
