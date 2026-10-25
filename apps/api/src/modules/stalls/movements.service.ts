import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  CheckedOutItem, CheckinBody, CheckinFailure, CheckinItem, CheckinResponse, CheckoutBody, CheckoutFailure, CheckoutResponse,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { EventBus } from '../../common/events/event-bus.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { Db, Tx } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { bookTitles, copies, racks, shelfRows, stallMovements, stalls, users } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { locationOf, positionKey, selectCopies, type CopyRow } from '../copies/copy-queries.js';
import { ShelfAllocationService } from '../shelves/shelf-allocation.service.js';

export interface PickListData {
  stallName: string;
  batchId: string;
  checkedOutAt: Date;
  checkedOutBy: string;
  rows: Array<{ locationCode: string | null; code: string; title: string; sellingPriceMinor: number }>;
}

@Injectable()
export class MovementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ShelfAllocationService) private readonly alloc: ShelfAllocationService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  private async titleNames(q: Db | Tx, titleIds: string[]): Promise<Map<string, string>> {
    if (!titleIds.length) return new Map();
    const rows = await q.select({ id: bookTitles.id, title: bookTitles.title }).from(bookTitles).where(inArray(bookTitles.id, [...new Set(titleIds)]));
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  // ───────────────────────── checkout ─────────────────────────

  /**
   * Sends copies to a stall. (A) explicit copies: partial success, bad ones are reported in `failed`.
   * (B) groups: "N copies of X (condition, price)", picked in shelf order; a group that cannot be filled
   * completely is skipped as a whole. The batch id is the client's `clientRef`, so retries replay.
   */
  async checkout(actorId: string, stallId: string, body: CheckoutBody, ip?: string): Promise<CheckoutResponse> {
    return this.txr.run(async (tx, afterCommit) => {
      const handle = await this.idem.begin<CheckoutResponse>(tx, 'stalls.checkout', body.clientRef, actorId);
      if (handle.replay) return handle.response;

      const [stall] = await tx.select().from(stalls).where(and(eq(stalls.id, stallId), isNull(stalls.deletedAt))).for('share');
      if (!stall) throw new AppError('NOT_FOUND', 'Stall not found');
      if (stall.status === 'CLOSED') throw new AppError('STALL_NOT_ACTIVE', 'This stall is closed');

      const failed: CheckoutFailure[] = [];
      const picked: CopyRow[] = [];

      if (body.copyIds) {
        const ids = [...new Set(body.copyIds)];
        const rows = await selectCopies(tx).where(inArray(copies.id, ids)).orderBy(asc(copies.id)).for('update', { of: copies });
        const byId = new Map(rows.map((r) => [r.copy.id, r]));
        for (const id of ids) {
          const r = byId.get(id);
          if (!r) failed.push({ copyId: id, reason: 'NOT_FOUND' });
          else if (r.copy.status !== 'IN_STOCK') failed.push({ copyId: id, code: r.copy.code, reason: 'COPY_NOT_AVAILABLE' });
          else picked.push(r);
        }
      } else {
        for (const g of body.groups!) {
          const where = and(
            eq(copies.titleId, g.titleId), eq(copies.condition, g.condition),
            eq(copies.sellingPriceMinor, g.sellingPriceMinor), eq(copies.status, 'IN_STOCK'),
          );
          let rows: CopyRow[] = [];
          // A concurrent checkout can steal rows between the SELECT and the lock; re-check a couple of times.
          for (let attempt = 0; attempt < 3; attempt++) {
            rows = await selectCopies(tx)
              .where(where)
              .orderBy(sql`${racks.sortOrder} ASC NULLS LAST`, sql`${shelfRows.rowNumber} ASC NULLS LAST`, sql`${copies.slotNumber} ASC NULLS LAST`, asc(copies.code))
              .limit(g.quantity)
              .for('update', { of: copies });
            if (rows.length >= g.quantity) break;
            const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(copies).where(where);
            if (n < g.quantity) break;
          }
          if (rows.length < g.quantity) {
            const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(copies).where(where);
            failed.push({ group: g, reason: 'INSUFFICIENT_STOCK', available: n });
          } else picked.push(...rows);
        }
      }

      const batchId = body.clientRef;
      const ids = picked.map((r) => r.copy.id);
      if (ids.length) {
        await tx
          .update(copies)
          .set({ status: 'AT_STALL', currentStallId: stallId, version: sql`${copies.version} + 1` })
          .where(inArray(copies.id, ids));
        await tx.insert(stallMovements).values(ids.map((copyId) => ({ copyId, stallId, batchId, checkedOutById: actorId })));
        await this.audit.record(tx, {
          actorId, action: 'stall.checkout', entityType: 'stall', entityId: stallId, ip,
          after: { batchId, count: ids.length, copyIds: ids, codes: picked.map((r) => r.copy.code), failed: failed.length },
        });
      }

      const names = await this.titleNames(tx, picked.map((r) => r.copy.titleId));
      const checkedOut: CheckedOutItem[] = picked
        .sort((a, b) => positionKey(a).localeCompare(positionKey(b)))
        .map((r) => ({ copyId: r.copy.id, code: r.copy.code, locationCode: locationOf(r), title: names.get(r.copy.titleId) ?? '' }));
      const response: CheckoutResponse = { batchId, checkedOut, failed };
      await handle.complete(response);
      if (ids.length) {
        afterCommit(() => this.events.publish({ name: 'inventory.changed', payload: { copyIds: ids, stallId }, rooms: ['role:admin', `stall:${stallId}`] }));
      }
      return response;
    });
  }

  async pickList(stallId: string, batchId: string): Promise<PickListData> {
    const [stall] = await this.db.select().from(stalls).where(eq(stalls.id, stallId));
    if (!stall) throw new AppError('NOT_FOUND', 'Stall not found');
    const moves = await this.db
      .select({ copyId: stallMovements.copyId, at: stallMovements.checkedOutAt, by: users.displayName })
      .from(stallMovements)
      .innerJoin(users, eq(users.id, stallMovements.checkedOutById))
      .where(and(eq(stallMovements.stallId, stallId), eq(stallMovements.batchId, batchId)));
    if (!moves.length) throw new AppError('NOT_FOUND', 'No checkout batch with that id at this stall');
    const rows = await selectCopies(this.db).where(inArray(copies.id, moves.map((m) => m.copyId)));
    const names = await this.titleNames(this.db, rows.map((r) => r.copy.titleId));
    return {
      stallName: stall.name,
      batchId,
      checkedOutAt: moves[0]!.at,
      checkedOutBy: moves[0]!.by,
      rows: rows
        .sort((a, b) => positionKey(a).localeCompare(positionKey(b)))
        .map((r) => ({
          locationCode: locationOf(r) ?? r.copy.lastLocationCode,
          code: r.copy.code,
          title: names.get(r.copy.titleId) ?? '',
          sellingPriceMinor: r.copy.sellingPriceMinor,
        })),
    };
  }

  // ───────────────────────── check-in ─────────────────────────

  /**
   * Brings copies back from any stall. Because a copy keeps its slot while out, it goes back to exactly
   * where it came from. If the slot is missing (data repair), a new one is allocated and `relocated` is set.
   */
  async checkin(actorId: string, body: CheckinBody, ip?: string): Promise<CheckinResponse> {
    return this.txr.run(async (tx, afterCommit) => {
      const handle = await this.idem.begin<CheckinResponse>(tx, 'stalls.checkin', body.clientRef, actorId);
      if (handle.replay) return handle.response;

      const keys = body.copyIds ? [...new Set(body.copyIds)] : [...new Set(body.codes!)];
      const rows = await selectCopies(tx)
        .where(body.copyIds ? inArray(copies.id, keys) : inArray(copies.code, keys))
        .orderBy(asc(copies.id))
        .for('update', { of: copies });
      const byKey = new Map(rows.map((r) => [body.copyIds ? r.copy.id : r.copy.code, r]));

      const failed: CheckinFailure[] = [];
      const ok: CopyRow[] = [];
      for (const k of keys) {
        const r = byKey.get(k);
        const ref = body.copyIds ? { copyId: k } : { code: k };
        if (!r) failed.push({ ...ref, reason: 'NOT_FOUND' });
        else if (r.copy.status !== 'AT_STALL') failed.push({ ...ref, code: r.copy.code, reason: 'NOT_AT_STALL' });
        else ok.push(r);
      }

      const stallIds = [...new Set(ok.map((r) => r.copy.currentStallId!))];
      const stallRows = stallIds.length ? await tx.select({ id: stalls.id, name: stalls.name }).from(stalls).where(inArray(stalls.id, stallIds)) : [];
      const names = await this.titleNames(tx, ok.map((r) => r.copy.titleId));

      const checkedIn: CheckinItem[] = [];
      const needsSlot = ok.filter((r) => !r.copy.rowId || r.copy.slotNumber === null);
      if (needsSlot.length) await this.alloc.lock(tx);

      for (const r of ok) {
        const fromStall = stallRows.find((s) => s.id === r.copy.currentStallId)!;
        let location = locationOf(r);
        let relocated = false;
        const patch: Partial<typeof copies.$inferInsert> = {};
        if (!r.copy.rowId || r.copy.slotNumber === null) {
          const [bt] = await tx.select({ genreId: bookTitles.genreId }).from(bookTitles).where(eq(bookTitles.id, r.copy.titleId));
          const a = await this.alloc.allocate(tx, bt!.genreId, 1, false);
          const p = a.placements[0];
          relocated = true;
          patch.labelNeedsPrint = true;
          if (p) {
            patch.rowId = p.rowId;
            patch.slotNumber = p.slot;
            patch.lastLocationCode = p.locationCode;
            location = p.locationCode;
          } else location = null; // no shelf space: stays unshelved
        }
        await tx
          .update(copies)
          .set({ ...patch, status: 'IN_STOCK', currentStallId: null, version: sql`${copies.version} + 1` })
          .where(eq(copies.id, r.copy.id));
        await tx
          .update(stallMovements)
          .set({ outcome: 'RETURNED', checkedInAt: new Date(), checkedInById: actorId })
          .where(and(eq(stallMovements.copyId, r.copy.id), eq(stallMovements.outcome, 'OPEN')));
        checkedIn.push({
          copyId: r.copy.id, code: r.copy.code, title: names.get(r.copy.titleId) ?? '',
          fromStall: { id: fromStall.id, name: fromStall.name }, returnToLocation: location, relocated,
        });
      }

      if (checkedIn.length) {
        await this.audit.record(tx, {
          actorId, action: 'stall.checkin', entityType: 'stall', entityId: stallIds.length === 1 ? stallIds[0]! : 'multiple', ip,
          after: { count: checkedIn.length, copyIds: checkedIn.map((c) => c.copyId), codes: checkedIn.map((c) => c.code), relocated: checkedIn.filter((c) => c.relocated).map((c) => c.code) },
        });
      }
      const response: CheckinResponse = { checkedIn, failed };
      await handle.complete(response);
      if (checkedIn.length) {
        afterCommit(() => {
          for (const s of stallIds) {
            this.events.publish({ name: 'inventory.changed', payload: { copyIds: checkedIn.map((c) => c.copyId), stallId: s }, rooms: ['role:admin', `stall:${s}`] });
          }
        });
      }
      return response;
    });
  }
}
