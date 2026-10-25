import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  formatLocation,
  type BulkRowsBody, type CreateRackBody, type CreateRowBody, type Page, type RackDto, type RowSlot,
  type ShelfMapRack, type ShelfMapRow, type ShelfRowDto, type UpdateRackBody, type UpdateRowBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { Db, Tx } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { bookTitles, copies, genres, racks, shelfRows } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { ShelfAllocationService } from './shelf-allocation.service.js';

const pad2 = (n: number) => String(n).padStart(2, '0');

type RowRecord = { row: typeof shelfRows.$inferSelect; rackCode: string };
const toRowDto = ({ row, rackCode }: RowRecord): ShelfRowDto => ({
  id: row.id, rackId: row.rackId, rackCode, rowNumber: row.rowNumber, code: row.code, capacity: row.capacity,
  genreId: row.genreId, isOverflow: row.isOverflow, isActive: row.isActive,
});

@Injectable()
export class ShelvesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ShelfAllocationService) private readonly alloc: ShelfAllocationService,
  ) {}

  // ── racks ──
  async listRacks(): Promise<RackDto[]> {
    return this.db.select().from(racks).orderBy(asc(racks.sortOrder), asc(racks.code));
  }

  async createRack(actorId: string, body: CreateRackBody): Promise<RackDto> {
    return this.txr.run(async (tx) => {
      const [dupe] = await tx.select({ id: racks.id }).from(racks).where(eq(racks.code, body.code));
      if (dupe) throw new AppError('CONFLICT', `Rack ${body.code} already exists`);
      const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${racks.sortOrder}), 0)::int` }).from(racks);
      const [rack] = await tx
        .insert(racks)
        .values({ code: body.code, name: body.name ?? null, sortOrder: body.sortOrder ?? max + 1 })
        .returning();
      await this.audit.record(tx, { actorId, action: 'shelf.rack.create', entityType: 'rack', entityId: rack!.id, after: rack });
      return rack!;
    });
  }

  async updateRack(actorId: string, id: string, body: UpdateRackBody): Promise<RackDto> {
    return this.txr.run(async (tx) => {
      const [before] = await tx.select().from(racks).where(eq(racks.id, id));
      if (!before) throw new AppError('NOT_FOUND', 'Rack not found');
      const [after] = await tx.update(racks).set(body).where(eq(racks.id, id)).returning();
      await this.audit.record(tx, { actorId, action: 'shelf.rack.update', entityType: 'rack', entityId: id, before, after });
      return after!;
    });
  }

  // ── rows ──
  async listRows(): Promise<ShelfRowDto[]> {
    const rows = await this.db
      .select({ row: shelfRows, rackCode: racks.code })
      .from(shelfRows)
      .innerJoin(racks, eq(racks.id, shelfRows.rackId))
      .orderBy(asc(racks.sortOrder), asc(shelfRows.rowNumber));
    return rows.map(toRowDto);
  }

  private async assertGenre(tx: Tx | Db, genreId: string | null | undefined) {
    if (!genreId) return;
    const [g] = await tx.select({ id: genres.id, isActive: genres.isActive }).from(genres).where(eq(genres.id, genreId));
    if (!g) throw new AppError('VALIDATION_FAILED', 'Unknown genre');
  }

  async createRow(actorId: string, body: CreateRowBody): Promise<ShelfRowDto> {
    return this.txr.run(async (tx) => {
      const [rack] = await tx.select().from(racks).where(eq(racks.id, body.rackId));
      if (!rack) throw new AppError('NOT_FOUND', 'Rack not found');
      await this.assertGenre(tx, body.genreId);
      const [dupe] = await tx
        .select({ id: shelfRows.id })
        .from(shelfRows)
        .where(and(eq(shelfRows.rackId, rack.id), eq(shelfRows.rowNumber, body.rowNumber)));
      if (dupe) throw new AppError('CONFLICT', `Row ${rack.code}${pad2(body.rowNumber)} already exists`);
      const [row] = await tx
        .insert(shelfRows)
        .values({
          rackId: rack.id, rowNumber: body.rowNumber, code: `${rack.code}${pad2(body.rowNumber)}`,
          capacity: body.capacity, genreId: body.genreId ?? null, isOverflow: body.isOverflow ?? false,
        })
        .returning();
      await this.audit.record(tx, { actorId, action: 'shelf.row.create', entityType: 'shelf_row', entityId: row!.id, after: row });
      return toRowDto({ row: row!, rackCode: rack.code });
    });
  }

  /** Adds `count` rows after the highest existing row number of the rack. */
  async bulkCreateRows(actorId: string, rackId: string, body: BulkRowsBody): Promise<ShelfRowDto[]> {
    return this.txr.run(async (tx) => {
      const [rack] = await tx.select().from(racks).where(eq(racks.id, rackId)).for('update');
      if (!rack) throw new AppError('NOT_FOUND', 'Rack not found');
      await this.assertGenre(tx, body.genreId);
      const [{ max } = { max: 0 }] = await tx
        .select({ max: sql<number>`coalesce(max(${shelfRows.rowNumber}), 0)::int` })
        .from(shelfRows)
        .where(eq(shelfRows.rackId, rackId));
      if (max + body.count > 99) throw new AppError('VALIDATION_FAILED', `A rack can have at most 99 rows (it has ${max})`);
      const created = await tx
        .insert(shelfRows)
        .values(
          Array.from({ length: body.count }, (_, i) => ({
            rackId, rowNumber: max + i + 1, code: `${rack.code}${pad2(max + i + 1)}`,
            capacity: body.capacity, genreId: body.genreId ?? null,
          })),
        )
        .returning();
      await this.audit.record(tx, {
        actorId, action: 'shelf.row.create', entityType: 'rack', entityId: rackId, after: created.map((r) => r.code),
      });
      return created.map((row) => toRowDto({ row, rackCode: rack.code }));
    });
  }

  /** Capacity/genre/active changes are blocked while the row holds copies that would be stranded. */
  async updateRow(actorId: string, id: string, body: UpdateRowBody): Promise<ShelfRowDto> {
    return this.txr.run(async (tx) => {
      await this.alloc.lock(tx); // no copy may be placed in this row while we validate
      const [rec] = await tx
        .select({ row: shelfRows, rackCode: racks.code })
        .from(shelfRows)
        .innerJoin(racks, eq(racks.id, shelfRows.rackId))
        .where(eq(shelfRows.id, id));
      if (!rec) throw new AppError('NOT_FOUND', 'Row not found');
      const row = rec.row;
      await this.assertGenre(tx, body.genreId);

      const held = await tx
        .select({ slot: copies.slotNumber, genreId: bookTitles.genreId, code: copies.code })
        .from(copies)
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .where(eq(copies.rowId, id));

      const newOverflow = body.isOverflow ?? row.isOverflow;
      if (body.capacity !== undefined && body.capacity < row.capacity) {
        const stranded = held.filter((h) => (h.slot ?? 0) > body.capacity!);
        if (stranded.length) {
          throw new AppError('ROW_NOT_EMPTY', `${stranded.length} book(s) sit in slots above ${body.capacity}; move them first`, {
            copies: stranded.map((s) => s.code),
          });
        }
      }
      if (body.genreId !== undefined && body.genreId !== row.genreId && !newOverflow) {
        const foreign = held.filter((h) => h.genreId !== body.genreId);
        if (foreign.length) {
          throw new AppError('ROW_NOT_EMPTY', `This row holds ${foreign.length} book(s) of another genre; move them first`, {
            copies: foreign.map((s) => s.code),
          });
        }
      }
      if (body.isActive === false && held.length) {
        throw new AppError('ROW_NOT_EMPTY', `This row still holds ${held.length} book(s); move them before deactivating it`);
      }

      const [after] = await tx.update(shelfRows).set(body).where(eq(shelfRows.id, id)).returning();
      await this.audit.record(tx, { actorId, action: 'shelf.row.update', entityType: 'shelf_row', entityId: id, before: row, after });
      return toRowDto({ row: after!, rackCode: rec.rackCode });
    });
  }

  // ── map & slots ──
  async map(): Promise<ShelfMapRack[]> {
    const [rackRows, rows, usage, genreRows] = await Promise.all([
      this.listRacks(),
      this.listRows(),
      this.db
        .select({
          rowId: copies.rowId,
          used: sql<number>`count(*)::int`,
          atStall: sql<number>`count(*) FILTER (WHERE ${copies.status} = 'AT_STALL')::int`,
        })
        .from(copies)
        .where(sql`${copies.rowId} IS NOT NULL`)
        .groupBy(copies.rowId),
      this.db.select().from(genres),
    ]);
    const usageBy = new Map(usage.map((u) => [u.rowId, u]));
    const genreBy = new Map(genreRows.map((g) => [g.id, g]));
    return rackRows.map((rack) => ({
      ...rack,
      rows: rows
        .filter((r) => r.rackId === rack.id)
        .map((r): ShelfMapRow => {
          const u = usageBy.get(r.id);
          const g = r.genreId ? genreBy.get(r.genreId) : undefined;
          const used = u?.used ?? 0;
          return {
            ...r,
            genre: g ? { id: g.id, name: g.name, code: g.code, color: g.color } : null,
            used,
            reservedAtStall: u?.atStall ?? 0,
            percentFull: Math.round((used / r.capacity) * 100),
          };
        }),
    }));
  }

  async rowSlots(rowId: string): Promise<{ row: ShelfRowDto; slots: RowSlot[] }> {
    const [rec] = await this.db
      .select({ row: shelfRows, rackCode: racks.code })
      .from(shelfRows)
      .innerJoin(racks, eq(racks.id, shelfRows.rackId))
      .where(eq(shelfRows.id, rowId));
    if (!rec) throw new AppError('NOT_FOUND', 'Row not found');
    const held = await this.db
      .select({ id: copies.id, code: copies.code, status: copies.status, slot: copies.slotNumber, title: bookTitles.title })
      .from(copies)
      .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
      .where(eq(copies.rowId, rowId));
    const bySlot = new Map(held.map((h) => [h.slot, h]));
    const slots: RowSlot[] = Array.from({ length: rec.row.capacity }, (_, i) => {
      const h = bySlot.get(i + 1);
      return { slot: i + 1, copy: h ? { id: h.id, code: h.code, title: h.title, status: h.status } : null };
    });
    return { row: toRowDto(rec), slots };
  }

  // ── unshelved ──
  async unshelved(page: number, pageSize: number) {
    const where = and(isNull(copies.rowId), eq(copies.status, 'IN_STOCK'));
    const [items, [{ n } = { n: 0 }]] = await Promise.all([
      this.db
        .select({
          id: copies.id, code: copies.code, title: bookTitles.title, genreId: bookTitles.genreId,
          genreCode: genres.code, sellingPriceMinor: copies.sellingPriceMinor, createdAt: copies.createdAt,
        })
        .from(copies)
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .innerJoin(genres, eq(genres.id, bookTitles.genreId))
        .where(where)
        .orderBy(asc(copies.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(copies).where(where),
    ]);
    return { items, page, pageSize, total: n } satisfies Page<(typeof items)[number]>;
  }

  /** Retries allocation for unshelved copies (e.g. after rows were added). Moved copies need new labels. */
  async placeUnshelved(actorId: string): Promise<{ placed: number; stillUnshelved: number }> {
    return this.txr.run(async (tx) => {
      await this.alloc.lock(tx);
      const pending = await tx
        .select({ id: copies.id, genreId: bookTitles.genreId })
        .from(copies)
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .where(and(isNull(copies.rowId), eq(copies.status, 'IN_STOCK')))
        .orderBy(asc(copies.createdAt))
        .for('update', { of: copies });
      const byGenre = new Map<string, string[]>();
      for (const p of pending) (byGenre.get(p.genreId) ?? byGenre.set(p.genreId, []).get(p.genreId)!).push(p.id);

      const moved: Array<{ id: string; location: string }> = [];
      for (const [genreId, ids] of byGenre) {
        const { placements } = await this.alloc.allocate(tx, genreId, ids.length, false);
        for (const [i, p] of placements.entries()) {
          await tx
            .update(copies)
            .set({
              rowId: p.rowId, slotNumber: p.slot, lastLocationCode: p.locationCode, labelNeedsPrint: true,
              version: sql`${copies.version} + 1`,
            })
            .where(eq(copies.id, ids[i]!));
          moved.push({ id: ids[i]!, location: p.locationCode });
        }
      }
      if (moved.length) {
        await this.audit.record(tx, { actorId, action: 'copy.move', entityType: 'copy', entityId: 'batch', after: moved });
      }
      return { placed: moved.length, stillUnshelved: pending.length - moved.length };
    });
  }

  /** Rows (with rack code and genre) for signs. */
  async rowsForSigns(rowIds?: string[]) {
    const rows = await this.db
      .select({ row: shelfRows, rackCode: racks.code, genre: genres })
      .from(shelfRows)
      .innerJoin(racks, eq(racks.id, shelfRows.rackId))
      .leftJoin(genres, eq(genres.id, shelfRows.genreId))
      .where(rowIds?.length ? inArray(shelfRows.id, rowIds) : eq(shelfRows.isActive, true))
      .orderBy(asc(racks.sortOrder), asc(shelfRows.rowNumber));
    return rows.map((r) => ({
      code: r.row.code,
      capacity: r.row.capacity,
      isOverflow: r.row.isOverflow,
      genre: r.genre,
      firstLocation: r.genre ? formatLocation(r.genre.code, r.rackCode, r.row.rowNumber, 1) : null,
    }));
  }
}
