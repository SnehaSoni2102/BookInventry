import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';

export const genres = pgTable(
  'genres',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull().unique(),
    code: text().notNull().unique(),
    color: text().notNull().default('#888888'),
    sortOrder: integer().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check('genres_code_format', sql`${t.code} ~ '^[A-Z]{2,4}$'`),
    check('genres_color_format', sql`${t.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const genreKeywords = pgTable(
  'genre_keywords',
  {
    id: uuid().primaryKey().defaultRandom(),
    genreId: uuid().notNull().references(() => genres.id, { onDelete: 'cascade' }),
    keyword: text().notNull(),
    weight: integer().notNull().default(1),
  },
  (t) => [
    unique('genre_keywords_genre_id_keyword_key').on(t.genreId, t.keyword),
    check('genre_keywords_lower', sql`${t.keyword} = lower(${t.keyword})`),
    index('genre_keywords_keyword_idx').on(t.keyword),
  ],
);

export const racks = pgTable(
  'racks',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    name: text(),
    sortOrder: integer().notNull(),
  },
  (t) => [check('racks_code_format', sql`${t.code} ~ '^[A-Z]{1,2}$'`)],
);

export const shelfRows = pgTable(
  'shelf_rows',
  {
    id: uuid().primaryKey().defaultRandom(),
    rackId: uuid().notNull().references(() => racks.id),
    rowNumber: integer().notNull(),
    code: text().notNull().unique(),
    capacity: integer().notNull(),
    genreId: uuid().references(() => genres.id),
    isOverflow: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('shelf_rows_rack_id_row_number_key').on(t.rackId, t.rowNumber),
    check('shelf_rows_row_number_range', sql`${t.rowNumber} BETWEEN 1 AND 99`),
    check('shelf_rows_capacity_range', sql`${t.capacity} BETWEEN 1 AND 999`),
    index('shelf_rows_genre_idx').on(t.genreId),
  ],
);
