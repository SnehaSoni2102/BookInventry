import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { formatLocation, type CopyDto } from '@bookstall/shared';
import { copies, bookTitles, genres, racks, shelfRows } from '../../db/schema/index.js';
import type { Q } from '../titles/title-queries.js';

const rowGenre = alias(genres, 'row_genre');

/** Copies joined with everything needed to render the location code. */
export const selectCopies = (q: Q) =>
  q
    .select({
      copy: copies,
      genreCode: genres.code,
      rackCode: racks.code,
      rackSort: racks.sortOrder,
      rowNumber: shelfRows.rowNumber,
      rowGenreCode: rowGenre.code,
      rowIsOverflow: shelfRows.isOverflow,
    })
    .from(copies)
    .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
    .innerJoin(genres, eq(genres.id, bookTitles.genreId))
    .leftJoin(shelfRows, eq(shelfRows.id, copies.rowId))
    .leftJoin(racks, eq(racks.id, shelfRows.rackId))
    .leftJoin(rowGenre, eq(rowGenre.id, shelfRows.genreId));

export interface CopyRow {
  copy: typeof copies.$inferSelect;
  genreCode: string;
  rackCode: string | null;
  rackSort: number | null;
  rowNumber: number | null;
  rowGenreCode: string | null;
  rowIsOverflow: boolean | null;
}

export function locationOf(r: CopyRow): string | null {
  const { copy } = r;
  if (!copy.rowId || copy.slotNumber === null || !r.rackCode || r.rowNumber === null) return null;
  // The prefix names the genre of the physical row, so it stays right if the title's genre is edited
  // before the copy is relocated. Overflow rows have no genre of their own: use the book's.
  const prefix = r.rowIsOverflow || !r.rowGenreCode ? r.genreCode : r.rowGenreCode;
  return formatLocation(prefix, r.rackCode, r.rowNumber, copy.slotNumber);
}

export function toCopyDto(r: CopyRow): CopyDto {
  const c = r.copy;
  return {
    id: c.id,
    code: c.code,
    titleId: c.titleId,
    condition: c.condition,
    conditionNotes: c.conditionNotes,
    originalPriceMinor: c.originalPriceMinor,
    sellingPriceMinor: c.sellingPriceMinor,
    status: c.status,
    locationCode: locationOf(r),
    rowId: c.rowId,
    slotNumber: c.slotNumber,
    currentStallId: c.currentStallId,
    donorName: c.donorName,
    notes: c.notes,
    labelNeedsPrint: c.labelNeedsPrint,
    labelPrintedAt: c.labelPrintedAt?.toISOString() ?? null,
    acquiredAt: c.acquiredAt.toISOString(),
    soldAt: c.soldAt?.toISOString() ?? null,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Walk order along the shelves: rack, row, slot. Unshelved copies sort last. */
export function positionKey(r: CopyRow): string {
  if (r.rackSort === null || r.rowNumber === null || r.copy.slotNumber === null) return '~' + r.copy.code;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(r.rackSort, 5)}-${pad(r.rowNumber, 3)}-${pad(r.copy.slotNumber, 4)}`;
}
