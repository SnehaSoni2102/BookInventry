import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  authorSort, searchText, titleSort,
  type CopyGroup, type MoveListItem, type TitleDetail, type TitleDto, type UpdateTitleBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { EventBus } from '../../common/events/event-bus.js';
import type { Scope } from '../../common/scope.js';
import type { Db } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { bookTitles, copies, genres, shelfRows, stalls } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { selectCopies, locationOf } from '../copies/copy-queries.js';
import { CoverService } from '../covers/cover.service.js';
import { ShelfAllocationService } from '../shelves/shelf-allocation.service.js';
import { selectTitles, toTitleDto, type Q } from './title-queries.js';

@Injectable()
export class TitlesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ShelfAllocationService) private readonly alloc: ShelfAllocationService,
    @Inject(CoverService) private readonly covers: CoverService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  async getDto(q: Q, id: string): Promise<TitleDto> {
    const [row] = await selectTitles(q).where(eq(bookTitles.id, id));
    if (!row) throw new AppError('NOT_FOUND', 'Title not found');
    return toTitleDto(row.title, row.genre);
  }

  /** Copies of the title that are still around (IN_STOCK / AT_STALL), grouped for the UI. */
  async copyGroups(q: Q, titleId: string, scope: Scope = { kind: 'all' }): Promise<CopyGroup[]> {
    const where = and(
      eq(copies.titleId, titleId),
      inArray(copies.status, ['IN_STOCK', 'AT_STALL']),
      scope.kind === 'stall'
        ? scope.stallId
          ? and(eq(copies.status, 'AT_STALL'), eq(copies.currentStallId, scope.stallId))
          : sql`false`
        : undefined,
    );
    const rows = await selectCopies(q).where(where).orderBy(asc(copies.sellingPriceMinor), asc(copies.code));
    const stallIds = [...new Set(rows.map((r) => r.copy.currentStallId).filter((x): x is string => Boolean(x)))];
    const stallRows = stallIds.length
      ? await q.select({ id: stalls.id, name: stalls.name }).from(stalls).where(inArray(stalls.id, stallIds))
      : [];
    const stallBy = new Map(stallRows.map((s) => [s.id, s]));

    const groups = new Map<string, CopyGroup>();
    for (const r of rows) {
      const c = r.copy;
      const stall = c.currentStallId ? (stallBy.get(c.currentStallId) ?? null) : null;
      const key = [c.condition, c.sellingPriceMinor, c.status, c.currentStallId ?? ''].join('|');
      let g = groups.get(key);
      if (!g) {
        g = {
          condition: c.condition,
          sellingPriceMinor: c.sellingPriceMinor,
          originalPriceMinor: c.originalPriceMinor,
          status: c.status,
          stall,
          quantity: 0,
          copies: [],
        };
        groups.set(key, g);
      }
      g.quantity++;
      g.copies.push({
        id: c.id, code: c.code, locationCode: locationOf(r), status: c.status, stall, createdAt: c.createdAt.toISOString(),
      });
    }
    return [...groups.values()];
  }

  async detail(id: string, scope: Scope): Promise<TitleDetail> {
    const title = await this.getDto(this.db, id);
    return { ...title, copyGroups: await this.copyGroups(this.db, id, scope) };
  }

  async update(actorId: string, id: string, body: UpdateTitleBody): Promise<{ title: TitleDto; requiresRelocation: number }> {
    const { version, ...fields } = body;
    return this.txr.run(async (tx, afterCommit) => {
      const [cur] = await tx.select().from(bookTitles).where(eq(bookTitles.id, id));
      if (!cur) throw new AppError('NOT_FOUND', 'Title not found');
      if (cur.version !== version) {
        throw new AppError('VERSION_CONFLICT', 'This title was changed by someone else; reload and try again', {
          currentVersion: cur.version,
        });
      }
      if (fields.genreId && fields.genreId !== cur.genreId) {
        const [g] = await tx.select({ id: genres.id }).from(genres).where(and(eq(genres.id, fields.genreId), eq(genres.isActive, true)));
        if (!g) throw new AppError('VALIDATION_FAILED', 'Unknown or inactive genre');
      }
      const next = { ...cur, ...fields };
      const [updated] = await tx
        .update(bookTitles)
        .set({
          ...fields,
          titleSort: titleSort(next.title),
          authorSort: authorSort(next.authors),
          searchText: searchText(next),
          version: sql`${bookTitles.version} + 1`,
        })
        .where(and(eq(bookTitles.id, id), eq(bookTitles.version, version)))
        .returning();
      if (!updated) throw new AppError('VERSION_CONFLICT', 'This title was changed by someone else; reload and try again');

      let requiresRelocation = 0;
      if (updated.genreId !== cur.genreId) {
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(copies)
          .leftJoin(shelfRows, eq(shelfRows.id, copies.rowId))
          .where(
            and(
              eq(copies.titleId, id),
              inArray(copies.status, ['IN_STOCK', 'AT_STALL']),
              sql`(${copies.rowId} IS NULL OR ${shelfRows.genreId} IS DISTINCT FROM ${updated.genreId} OR ${shelfRows.isOverflow})`,
            ),
          );
        requiresRelocation = n;
      }
      await this.audit.record(tx, {
        actorId, action: 'title.update', entityType: 'title', entityId: id,
        before: pickChanged(cur, fields), after: fields,
      });
      afterCommit(() => this.events.publish({ name: 'title.updated', payload: { titleId: id } }));
      return { title: await this.getDto(tx, id), requiresRelocation };
    });
  }

  async uploadCover(actorId: string, id: string, file: Buffer): Promise<TitleDto> {
    await this.getDto(this.db, id);
    await this.covers.processAndStore(id, file);
    await this.db.update(bookTitles).set({ version: sql`${bookTitles.version} + 1` }).where(eq(bookTitles.id, id));
    await this.audit.record(this.db, { actorId, action: 'title.update', entityType: 'title', entityId: id, after: { cover: 'uploaded' } });
    return this.getDto(this.db, id);
  }

  /**
   * Moves this title's shelved/in-stock copies into its current genre's rows (after a genre change).
   * Copies that are out at a stall have their reserved slot moved, so they return to the right place.
   * Copies with nowhere to go stay where they are. Labels must be reprinted.
   */
  async relocate(actorId: string, id: string): Promise<{ moves: MoveListItem[]; notMoved: number; warnings: string[] }> {
    return this.txr.run(async (tx) => {
      await this.alloc.lock(tx);
      const [t] = await tx.select().from(bookTitles).where(eq(bookTitles.id, id));
      if (!t) throw new AppError('NOT_FOUND', 'Title not found');

      const rows = await selectCopies(tx)
        .where(and(eq(copies.titleId, id), inArray(copies.status, ['IN_STOCK', 'AT_STALL'])))
        .orderBy(asc(copies.code))
        .for('update', { of: copies });
      const inRowOfGenre = new Set(
        (
          await tx
            .select({ id: shelfRows.id })
            .from(shelfRows)
            .where(and(eq(shelfRows.genreId, t.genreId), eq(shelfRows.isOverflow, false)))
        ).map((r) => r.id),
      );
      const todo = rows.filter((r) => !(r.copy.rowId && inRowOfGenre.has(r.copy.rowId)));
      if (!todo.length) return { moves: [], notMoved: 0, warnings: [] };

      const { placements } = await this.alloc.allocate(tx, t.genreId, todo.length, true);
      const moves: MoveListItem[] = [];
      for (const [i, p] of placements.entries()) {
        const r = todo[i]!;
        await tx
          .update(copies)
          .set({
            rowId: p.rowId, slotNumber: p.slot, lastLocationCode: p.locationCode, labelNeedsPrint: true,
            version: sql`${copies.version} + 1`,
          })
          .where(eq(copies.id, r.copy.id));
        moves.push({ code: r.copy.code, from: locationOf(r), to: p.locationCode });
      }
      const notMoved = todo.length - placements.length;
      if (moves.length) {
        await this.audit.record(tx, { actorId, action: 'copy.move', entityType: 'title', entityId: id, after: moves });
      }
      return { moves, notMoved, warnings: notMoved ? ['NO_SHELF_SPACE'] : [] };
    });
  }
}

function pickChanged<T extends object>(cur: T, fields: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(fields) as Array<keyof T>) out[k] = cur[k];
  return out;
}
