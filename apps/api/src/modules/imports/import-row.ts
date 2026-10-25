import {
  normalizeText, parseMoneyToMinor, toIsbn13, isbn13To10, cleanIsbn,
  type BookCondition, type ImportMessage, type CatalogLookupResult,
} from '@bookstall/shared';
import type { RawRow } from './import-parse.js';

export interface GenreIndex {
  /** normalized name or code → genre id */
  byKey: Map<string, string>;
}

export function buildGenreIndex(genres: Array<{ id: string; name: string; code: string }>): GenreIndex {
  const byKey = new Map<string, string>();
  for (const g of genres) {
    byKey.set(normalizeText(g.name), g.id);
    byKey.set(normalizeText(g.code), g.id);
  }
  return { byKey };
}

export type LookupSource = 'LOCAL' | 'OPEN_LIBRARY' | 'GOOGLE_BOOKS' | 'NONE';

/** What the commit step needs to create the copies. Stored in import_rows.normalized. */
export interface NormalizedImportRow {
  /** Set when the ISBN is already in inventory: metadata is not touched, copies are added to that title. */
  titleId?: string;
  title: {
    isbn13?: string; isbn10?: string; title: string; subtitle?: string; authors: string[]; publisher?: string;
    publishedYear?: number; language?: string; pageCount?: number; summary?: string; subjects: string[];
    genreId: string; coverUrl?: string; externalIds: Record<string, string>;
  } | null;
  copy: { condition: BookCondition; originalPriceMinor?: number; sellingPriceMinor: number; donorName?: string; notes?: string };
  quantity: number;
  lookup: LookupSource;
}

export interface RowResult {
  normalized: NormalizedImportRow | null;
  messages: ImportMessage[];
  status: 'VALID' | 'WARNING' | 'ERROR';
  /** `isbn13|condition|price`, for in-file duplicate detection. */
  dedupeKey: string | null;
}

const CONDITIONS: Record<string, BookCondition> = {
  new: 'NEW', likenew: 'LIKE_NEW', verygood: 'VERY_GOOD', good: 'GOOD', fair: 'FAIR', poor: 'POOR',
};
const LANGUAGES: Record<string, string> = {
  english: 'en', hindi: 'hi', marathi: 'mr', bengali: 'bn', tamil: 'ta', telugu: 'te', gujarati: 'gu', kannada: 'kn',
  malayalam: 'ml', punjabi: 'pa', urdu: 'ur', sanskrit: 'sa', french: 'fr', german: 'de', spanish: 'es',
};

export function parseCondition(v: string | undefined): BookCondition | null {
  return CONDITIONS[(v ?? '').toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

/**
 * Validates one spreadsheet row. Cell values the user typed always win; a catalogue lookup (if any)
 * only fills blanks. Pure: no I/O, so the same function revalidates a row after an edit.
 */
export function validateImportRow(
  raw: RawRow,
  ctx: { genres: GenreIndex; lookup?: CatalogLookupResult | null; lookupFailed?: boolean },
): RowResult {
  const messages: ImportMessage[] = [];
  const err = (field: string, message: string) => messages.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => messages.push({ level: 'warning', field, message });

  // ISBN
  let isbn13: string | undefined;
  if (raw.isbn) {
    const parsed = toIsbn13(raw.isbn);
    if (!parsed) err('isbn', `"${raw.isbn}" is not a valid ISBN-10 or ISBN-13`);
    else isbn13 = parsed;
  }

  // condition
  const condition = parseCondition(raw.condition);
  if (!raw.condition) err('condition', 'Condition is required');
  else if (!condition) err('condition', `"${raw.condition}" is not a condition (use NEW, LIKE_NEW, VERY_GOOD, GOOD, FAIR or POOR)`);

  // prices
  const selling = raw.selling_price ? parseMoneyToMinor(raw.selling_price) : null;
  if (!raw.selling_price) err('selling_price', 'Selling price is required');
  else if (selling === null) err('selling_price', `"${raw.selling_price}" is not a valid price`);
  let original: number | undefined;
  if (raw.original_price) {
    const o = parseMoneyToMinor(raw.original_price);
    if (o === null) warn('original_price', `"${raw.original_price}" is not a valid price; MRP ignored`);
    else original = o;
  }
  if (selling !== null && original !== undefined && selling > original) warn('selling_price', 'Selling price is higher than the MRP');

  // quantity
  let quantity = 1;
  if (raw.quantity) {
    const q = Number(raw.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 200) err('quantity', `Quantity must be a whole number from 1 to 200 (got "${raw.quantity}")`);
    else quantity = q;
  }

  // metadata, merged: typed values first, then the lookup
  const lookup = ctx.lookup ?? null;
  const meta = lookup?.found ? lookup.metadata : undefined;
  const existingTitleId = lookup?.inInventory ? lookup.titleId : undefined;
  const source: LookupSource = !lookup?.found ? 'NONE' : lookup.source === 'LOCAL' ? 'LOCAL' : lookup.source === 'GOOGLE_BOOKS' ? 'GOOGLE_BOOKS' : 'OPEN_LIBRARY';
  if (ctx.lookupFailed && raw.isbn && !meta) warn('isbn', 'Online lookup was unavailable; fill the title and genre by hand if they are missing');

  const title = raw.title || meta?.title || '';
  if (!existingTitleId && !title) err('title', raw.isbn ? 'Title is missing and the ISBN was not found online' : 'Title is required when there is no ISBN');

  const authors = raw.authors ? raw.authors.split(/[;|]/).map((a) => a.trim()).filter(Boolean) : (meta?.authors ?? []);

  // genre
  let genreId: string | undefined;
  if (raw.genre) {
    genreId = ctx.genres.byKey.get(normalizeText(raw.genre));
    if (!genreId) err('genre', `Unknown genre "${raw.genre}" (use a genre name or code from the Genres sheet)`);
  } else if (!existingTitleId) {
    genreId = lookup?.suggestedGenreId;
    if (genreId) warn('genre', 'Genre was suggested from online data; please check it');
    else err('genre', 'Genre is required (it could not be worked out automatically)');
  }

  // optional metadata that is dropped, not fatal, when bad
  let publishedYear: number | undefined;
  if (raw.published_year) {
    const y = Number(raw.published_year);
    if (Number.isInteger(y) && y >= 1400 && y <= 2100) publishedYear = y;
    else warn('published_year', `"${raw.published_year}" is not a valid year; ignored`);
  } else if (meta?.publishedYear) publishedYear = meta.publishedYear;

  let language: string | undefined;
  if (raw.language) {
    const l = raw.language.toLowerCase().trim();
    language = /^[a-z]{2,3}$/.test(l) ? l : LANGUAGES[normalizeText(l)];
    if (!language) warn('language', `"${raw.language}" is not a recognised language; ignored`);
  } else if (meta?.language) language = meta.language;

  let coverUrl: string | undefined;
  if (raw.cover_url) {
    if (/^https?:\/\/\S+$/i.test(raw.cover_url)) coverUrl = raw.cover_url;
    else warn('cover_url', 'Cover URL must start with http:// or https://; ignored');
  } else if (meta?.coverUrl) coverUrl = meta.coverUrl;

  let summary = raw.summary || meta?.summary || undefined;
  if (summary && summary.length > 4000) {
    summary = summary.slice(0, 3999) + '…';
    warn('summary', 'Summary was longer than 4,000 characters and was shortened');
  }

  const hasError = messages.some((m) => m.level === 'error');
  const status = hasError ? 'ERROR' : messages.length ? 'WARNING' : 'VALID';
  const dedupeKey = isbn13 && condition && selling !== null ? `${isbn13}|${condition}|${selling}` : null;
  if (hasError || !condition || selling === null) return { normalized: null, messages, status, dedupeKey };

  const normalized: NormalizedImportRow = {
    ...(existingTitleId ? { titleId: existingTitleId } : {}),
    title: existingTitleId
      ? null
      : {
          ...(isbn13 ? { isbn13, ...(isbn13To10(isbn13) ? { isbn10: isbn13To10(isbn13)! } : {}) } : {}),
          title, authors, subjects: meta?.subjects ?? [], genreId: genreId!, externalIds: meta?.externalIds ?? {},
          ...(meta?.subtitle ? { subtitle: meta.subtitle } : {}),
          ...((raw.publisher || meta?.publisher) ? { publisher: raw.publisher || meta!.publisher! } : {}),
          ...(publishedYear ? { publishedYear } : {}),
          ...(language ? { language } : {}),
          ...(meta?.pageCount ? { pageCount: meta.pageCount } : {}),
          ...(summary ? { summary } : {}),
          ...(coverUrl ? { coverUrl } : {}),
        },
    copy: {
      condition, sellingPriceMinor: selling,
      ...(original !== undefined ? { originalPriceMinor: original } : {}),
      ...(raw.donor ? { donorName: raw.donor } : {}),
      ...(raw.notes ? { notes: raw.notes } : {}),
    },
    quantity,
    lookup: source,
  };
  return { normalized, messages, status, dedupeKey };
}

/** Does this row need a catalogue lookup? (Has an ISBN, and something the lookup could fill is blank.) */
export function wantsLookup(raw: RawRow): string | null {
  if (!raw.isbn) return null;
  const isbn13 = toIsbn13(cleanIsbn(raw.isbn));
  if (!isbn13) return null;
  const complete = raw.title && raw.authors && raw.genre && raw.summary && raw.cover_url;
  return complete ? null : isbn13;
}

export const ROW_DUPLICATE_WARNING: ImportMessage = {
  level: 'warning',
  field: 'isbn',
  message: 'Duplicate of an earlier row (same ISBN, condition and price). Each row still creates its own copies; check this is not double-counted.',
};
