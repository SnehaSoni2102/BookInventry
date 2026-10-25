import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userRole } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    username: text().notNull().unique(),
    displayName: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull(),
    isActive: boolean().notNull().default(true),
    mustChangePassword: boolean().notNull().default(true),
    tokenVersion: integer().notNull().default(0),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check('users_username_format', sql`${t.username} = lower(${t.username}) AND ${t.username} ~ '^[a-z0-9._-]{3,32}$'`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);
