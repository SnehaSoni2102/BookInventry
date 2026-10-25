import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { metadataSource } from './enums.js';
import { genres } from './shelves.js';

export const bookTitles = pgTable(
  'book_titles',
  {
    id: uuid().primaryKey().defaultRandom(),
    isbn13: text().unique(),
    isbn10: text(),
    title: text().notNull(),
    subtitle: text(),
    authors: text().array().notNull().default(sql`'{}'::text[]`),
    authorSort: text().notNull().default(''),
    titleSort: text().notNull(),
    publisher: text(),
    publishedYear: integer(),
    language: text(),
    pageCount: integer(),
    edition: text(),
    summary: text(),
    subjects: text().array().notNull().default(sql`'{}'::text[]`),
    genreId: uuid().notNull().references(() => genres.id),
    coverKey: text(),
    coverSourceUrl: text(),
    source: metadataSource().notNull(),
    externalIds: jsonb().notNull().default({}),
    searchText: text().notNull(),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check('book_titles_isbn13_format', sql`${t.isbn13} ~ '^97[89][0-9]{10}$'`),
    check('book_titles_isbn10_format', sql`${t.isbn10} ~ '^[0-9]{9}[0-9X]$'`),
    check('book_titles_title_len', sql`length(${t.title}) BETWEEN 1 AND 500`),
    check('book_titles_year_range', sql`${t.publishedYear} BETWEEN 1400 AND 2100`),
    check('book_titles_pages_positive', sql`${t.pageCount} > 0`),
    check('book_titles_summary_len', sql`length(${t.summary}) <= 4000`),
    index('book_titles_genre_idx').on(t.genreId),
    index('book_titles_title_sort_idx').on(t.titleSort),
    index('book_titles_author_sort_idx').on(t.authorSort),
    index('book_titles_search_trgm').using('gin', t.searchText.op('gin_trgm_ops')),
  ],
);
