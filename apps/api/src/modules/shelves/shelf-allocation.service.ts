import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { formatLocation, type Placement } from '@bookstall/shared';
import type { Tx } from '../../db/client.js';
import { copies, genres, racks, shelfRows } from '../../db/schema/index.js';
import { sql } from 'drizzle-orm';

export interface AllocationResult {
  placements: Placement[];
  /** Copies that did not fit anywhere; create them unshelved (row_id NULL) and warn NO_SHELF_SPACE. */
  unplaced: number;
  genreCode: string;
}

interface Candidate {
  id: string;
  rackCode: string;
  rowNumber: number;
  free: number[];
}

/**
 * Gives each new copy a unique (row, slot), grouped by genre (01-DATABASE §4).
 * A single global advisory lock serialises allocation; it is released when the caller's transaction
 * ends, so the caller MUST insert the copies in the same transaction before committing.
 */
@Injectable()
export class ShelfAllocationService {
  async lock(tx: Tx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('shelf-alloc'))`);
  }

  async allocate(tx: Tx, genreId: string, count = 1, preferContiguous = true): Promise<AllocationResult> {
    await this.lock(tx);
    const [genre] = await tx.select({ code: genres.code }).from(genres).where(eq(genres.id, genreId));
    if (!genre) throw new Error(`Unknown genre ${genreId}`);

    const genreRows = await this.candidates(tx, and(eq(shelfRows.genreId, genreId), eq(shelfRows.isOverflow, false)));
    const overflowRows = await this.candidates(tx, eq(shelfRows.isOverflow, true));

    const picked: Array<{ row: Candidate; slot: number }> = [];

    if (preferContiguous && count > 1) {
      const run = findRun(genreRows, count);
      if (run) picked.push(...run);
    }
    for (const row of [...genreRows, ...overflowRows]) {
      if (picked.length >= count) break;
      const already = new Set(picked.filter((p) => p.row === row).map((p) => p.slot));
      for (const slot of row.free) {
        if (picked.length >= count) break;
        if (!already.has(slot)) picked.push({ row, slot });
      }
    }

    return {
      placements: picked.map(({ row, slot }) => ({
        rowId: row.id,
        slot,
        locationCode: formatLocation(genre.code, row.rackCode, row.rowNumber, slot),
      })),
      unplaced: count - picked.length,
      genreCode: genre.code,
    };
  }

  private async candidates(tx: Tx, where: ReturnType<typeof and> | ReturnType<typeof eq>): Promise<Candidate[]> {
    const rows = await tx
      .select({
        id: shelfRows.id,
        capacity: shelfRows.capacity,
        rowNumber: shelfRows.rowNumber,
        rackCode: racks.code,
      })
      .from(shelfRows)
      .innerJoin(racks, eq(racks.id, shelfRows.rackId))
      .where(and(eq(shelfRows.isActive, true), where))
      .orderBy(asc(racks.sortOrder), asc(shelfRows.rowNumber));
    if (!rows.length) return [];
    const taken = await tx
      .select({ rowId: copies.rowId, slot: copies.slotNumber })
      .from(copies)
      .where(inArray(copies.rowId, rows.map((r) => r.id)));
    const occupied = new Map<string, Set<number>>();
    for (const t of taken) {
      if (!t.rowId || t.slot === null) continue;
      (occupied.get(t.rowId) ?? occupied.set(t.rowId, new Set()).get(t.rowId)!).add(t.slot);
    }
    return rows.map((r) => {
      const used = occupied.get(r.id);
      const free: number[] = [];
      for (let s = 1; s <= r.capacity; s++) if (!used?.has(s)) free.push(s);
      return { id: r.id, rackCode: r.rackCode, rowNumber: r.rowNumber, free };
    });
  }
}

/** First row that has `count` consecutive free slots, scanning rows in order. */
function findRun(rows: Candidate[], count: number): Array<{ row: Candidate; slot: number }> | null {
  for (const row of rows) {
    let start = 0;
    for (let i = 1; i <= row.free.length; i++) {
      const brokeRun = i === row.free.length || row.free[i] !== row.free[i - 1]! + 1;
      if (brokeRun) {
        if (i - start >= count) return row.free.slice(start, start + count).map((slot) => ({ row, slot }));
        start = i;
      }
    }
  }
  return null;
}
