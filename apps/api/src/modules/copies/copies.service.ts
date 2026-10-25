import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  authorSort, can, searchText, titleSort,
  type CopyDetail, type CopyDto, type CopyWarning, type CreateCopiesBody, type CreateCopiesResponse,
  type MoveCopyBody, type TitleInput, type UpdateCopyBody, type WriteOffBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/decorators/index.js';
import { EventBus } from '../../common/events/event-bus.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { Scope } from '../../common/scope.js';
import type { Db, Tx } from '../../db/client.js';
import { DB, TxRunner, type AfterCommit } from '../../db/db.module.js';
import {
  bookTitles, copies, genres, saleItems, sales, shelfRows, stallMovements, stalls, users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { CoverService } from '../covers/cover.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShelfAllocationService } from '../shelves/shelf-allocation.service.js';
import { ShelfCapacityService } from '../shelves/shelf-capacity.service.js';
import { selectTitles, toTitleDto, type Q } from '../titles/title-queries.js';
import { locationOf, selectCopies, toCopyDto } from './copy-queries.js';

type Required_ = 'title' | 'authors' | 'subjects' | 'genreId' | 'source' | 'externalIds';
/** Same as the validated API input, but optional text fields may simply be absent (importers build this by hand). */
type TitleData = Pick<TitleInput, Required_> & Partial<Omit<TitleInput, Required_>>;
type CopyInput = Pick<CreateCopiesBody, 'titleId' | 'copy' | 'quantity'> & { title?: TitleData };

@Injectable()
export class CopiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ShelfAllocationService) private readonly alloc: ShelfAllocationService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
    @Inject(CoverService) private readonly covers: CoverService,
    @Inject(EventBus) private readonly events: EventBus,
    @Inject(ShelfCapacityService) private readonly capacity: ShelfCapacityService,
  ) {}

  // ───────────────────────── create ─────────────────────────

  /** `POST /copies`: the main data-entry flow, idempotent on `clientRef`. */
  async create(user: AuthUser, body: CreateCopiesBody, ip?: string): Promise<CreateCopiesResponse> {
    return this.txr.run(async (tx, afterCommit) => {
      const handle = await this.idem.begin<CreateCopiesResponse>(tx, 'copies.create', body.clientRef, user.id);
      if (handle.replay) return handle.response;
      const result = await this.createWithTitle(tx, user.id, body, afterCommit, ip);
      await handle.complete(result);
      return result;
    });
  }

  /** Shared by `POST /copies` and the Excel import commit. Runs inside the caller's transaction. */
  async createWithTitle(
    tx: Tx,
    actorId: string,
    input: CopyInput,
    afterCommit: AfterCommit,
    ip?: string,
  ): Promise<CreateCopiesResponse> {
    const warnings: CopyWarning[] = [];
    const { titleId, isNew, coverUrl } = await this.resolveTitle(tx, actorId, input, warnings, ip);
    const [t] = await selectTitles(tx).where(eq(bookTitles.id, titleId));
    const title = t!;

    const prefix = (await this.settings.get<string>('copy.codePrefix', tx)).toUpperCase();
    const seq = await tx.execute<{ n: string }>(sql`SELECT nextval('copy_code_seq')::text AS n FROM generate_series(1, ${input.quantity})`);
    const codes = seq.rows.map((r) => prefix + r.n.padStart(7, '0'));

    const { placements, unplaced } = await this.alloc.allocate(tx, title.title.genreId, input.quantity, true);
    if (unplaced > 0) warnings.push('NO_SHELF_SPACE');

    const f = input.copy;
    const inserted = await tx
      .insert(copies)
      .values(
        codes.map((code, i) => ({
          code,
          titleId,
          condition: f.condition,
          conditionNotes: f.conditionNotes ?? null,
          originalPriceMinor: f.originalPriceMinor ?? null,
          sellingPriceMinor: f.sellingPriceMinor,
          rowId: placements[i]?.rowId ?? null,
          slotNumber: placements[i]?.slot ?? null,
          lastLocationCode: placements[i]?.locationCode ?? null,
          donorName: f.donorName ?? null,
          notes: f.notes ?? null,
          labelNeedsPrint: true,
          createdById: actorId,
        })),
      )
      .returning({ id: copies.id });
    const ids = inserted.map((r) => r.id);

    await this.audit.record(tx, {
      actorId, action: 'copy.create', entityType: 'title', entityId: titleId, ip,
      after: { copyIds: ids, codes, quantity: input.quantity, condition: f.condition, sellingPriceMinor: f.sellingPriceMinor },
    });

    afterCommit(async () => {
      if (isNew && coverUrl) await this.covers.enqueueFetch(titleId, coverUrl);
      this.events.publish({ name: 'inventory.changed', payload: { copyIds: ids }, rooms: ['role:admin'] });
      await this.capacity.check(title.title.genreId).catch(() => undefined);
    });

    const rows = await selectCopies(tx).where(inArray(copies.id, ids)).orderBy(asc(copies.code));
    return {
      title: toTitleDto(title.title, title.genre),
      copies: rows.map(toCopyDto),
      warnings,
      labelPdfUrl: `/api/v1/labels/pdf?copyIds=${ids.join(',')}`,
    };
  }

  private async resolveTitle(
    tx: Tx, actorId: string, input: CopyInput, warnings: CopyWarning[], ip?: string,
  ): Promise<{ titleId: string; isNew: boolean; coverUrl?: string }> {
    if (input.titleId) {
      const [t] = await tx.select({ id: bookTitles.id }).from(bookTitles).where(eq(bookTitles.id, input.titleId));
      if (!t) throw new AppError('NOT_FOUND', 'Title not found');
      return { titleId: t.id, isNew: false };
    }
    const t = input.title!;
    if (t.isbn13) {
      const [existing] = await tx.select({ id: bookTitles.id }).from(bookTitles).where(eq(bookTitles.isbn13, t.isbn13));
      if (existing) {
        warnings.push('TITLE_EXISTS_METADATA_IGNORED');
        return { titleId: existing.id, isNew: false };
      }
    }
    const [g] = await tx.select({ id: genres.id }).from(genres).where(and(eq(genres.id, t.genreId), eq(genres.isActive, true)));
    if (!g) throw new AppError('VALIDATION_FAILED', 'Unknown or inactive genre');

    const [row] = await tx
      .insert(bookTitles)
      .values({
        isbn13: t.isbn13 ?? null,
        isbn10: t.isbn10 ?? null,
        title: t.title,
        subtitle: t.subtitle ?? null,
        authors: t.authors,
        authorSort: authorSort(t.authors),
        titleSort: titleSort(t.title),
        publisher: t.publisher ?? null,
        publishedYear: t.publishedYear ?? null,
        language: t.language ?? null,
        pageCount: t.pageCount ?? null,
        edition: t.edition ?? null,
        summary: t.summary ?? null,
        subjects: t.subjects,
        genreId: t.genreId,
        coverSourceUrl: t.coverUrl ?? null,
        source: t.source,
        externalIds: t.externalIds,
        searchText: searchText(t),
      })
      .returning({ id: bookTitles.id });
    await this.audit.record(tx, { actorId, action: 'title.create', entityType: 'title', entityId: row!.id, after: { title: t.title, isbn13: t.isbn13 ?? null }, ip });
    return { titleId: row!.id, isNew: true, coverUrl: t.coverUrl };
  }

  // ───────────────────────── read ─────────────────────────

  private assertVisible(scope: Scope, c: { status: string; currentStallId: string | null }) {
    if (scope.kind === 'all') return;
    if (!scope.stallId || c.status !== 'AT_STALL' || c.currentStallId !== scope.stallId) {
      throw new AppError('NOT_FOUND', 'Copy not found');
    }
  }

  async detail(q: Q, where: ReturnType<typeof eq>, scope: Scope): Promise<CopyDetail> {
    const [row] = await selectCopies(q).where(where);
    if (!row) throw new AppError('NOT_FOUND', 'Copy not found');
    this.assertVisible(scope, row.copy);
    const c = row.copy;

    const [titleRow] = await selectTitles(q).where(eq(bookTitles.id, c.titleId));
    const stall = c.currentStallId
      ? ((await q.select({ id: stalls.id, name: stalls.name }).from(stalls).where(eq(stalls.id, c.currentStallId)))[0] ?? null)
      : null;
    const moves = await q
      .select({
        id: stallMovements.id, stallId: stalls.id, stallName: stalls.name, outAt: stallMovements.checkedOutAt,
        inAt: stallMovements.checkedInAt, outcome: stallMovements.outcome, outBy: users.displayName,
      })
      .from(stallMovements)
      .innerJoin(stalls, eq(stalls.id, stallMovements.stallId))
      .innerJoin(users, eq(users.id, stallMovements.checkedOutById))
      .where(eq(stallMovements.copyId, c.id))
      .orderBy(desc(stallMovements.checkedOutAt));
    const open = moves.find((m) => m.outcome === 'OPEN');
    const [sale] =
      c.status === 'SOLD'
        ? await q
            .select({ saleId: sales.id, receiptNo: sales.receiptNo, soldPriceMinor: saleItems.soldPriceMinor, soldAt: sales.soldAt })
            .from(saleItems)
            .innerJoin(sales, eq(sales.id, saleItems.saleId))
            .where(and(eq(saleItems.copyId, c.id), eq(sales.status, 'COMPLETED')))
            .orderBy(desc(sales.soldAt))
            .limit(1)
        : [];

    return {
      ...toCopyDto(row),
      title: toTitleDto(titleRow!.title, titleRow!.genre),
      stall,
      openMovement: open ? { id: open.id, stallId: open.stallId, checkedOutAt: open.outAt.toISOString(), checkedOutBy: open.outBy } : null,
      sale: sale ? { ...sale, soldAt: sale.soldAt.toISOString() } : null,
      movements: moves.map((m) => ({
        id: m.id, stall: { id: m.stallId, name: m.stallName }, checkedOutAt: m.outAt.toISOString(),
        checkedInAt: m.inAt?.toISOString() ?? null, outcome: m.outcome,
      })),
    };
  }

  getById(id: string, scope: Scope) {
    return this.detail(this.db, eq(copies.id, id), scope);
  }

  getByCode(code: string, scope: Scope) {
    return this.detail(this.db, eq(copies.code, code.toUpperCase()), scope);
  }

  // ───────────────────────── update ─────────────────────────

  async update(user: AuthUser, id: string, body: UpdateCopyBody, ip?: string): Promise<CopyDto> {
    const { version, ...fields } = body;
    const touchesPrice = fields.sellingPriceMinor !== undefined || fields.originalPriceMinor !== undefined;
    if (touchesPrice && !can(user, 'copy.price.update')) throw new AppError('FORBIDDEN', 'You may not change prices');
    const touchesOther = Object.keys(fields).some((k) => k !== 'sellingPriceMinor' && k !== 'originalPriceMinor');
    if (touchesOther && !can(user, 'copy.update')) throw new AppError('FORBIDDEN', 'You may not edit copies');

    return this.txr.run(async (tx, afterCommit) => {
      const [cur] = await tx.select().from(copies).where(eq(copies.id, id)).for('update');
      if (!cur) throw new AppError('NOT_FOUND', 'Copy not found');
      if (cur.version !== version) {
        throw new AppError('VERSION_CONFLICT', 'This copy was changed by someone else; reload and try again', { currentVersion: cur.version });
      }
      if (cur.status === 'SOLD' || cur.status === 'WRITTEN_OFF') {
        throw new AppError('COPY_NOT_AVAILABLE', 'Sold or written-off copies cannot be edited', { codes: [cur.code] });
      }
      const priceChanged =
        (fields.sellingPriceMinor !== undefined && fields.sellingPriceMinor !== cur.sellingPriceMinor) ||
        (fields.originalPriceMinor !== undefined && fields.originalPriceMinor !== cur.originalPriceMinor);
      const labelChanged = priceChanged || (fields.condition !== undefined && fields.condition !== cur.condition);

      await tx
        .update(copies)
        .set({ ...fields, ...(labelChanged ? { labelNeedsPrint: true } : {}), version: sql`${copies.version} + 1` })
        .where(eq(copies.id, id));

      if (priceChanged) {
        await this.audit.record(tx, {
          actorId: user.id, action: 'copy.price.update', entityType: 'copy', entityId: id, ip,
          before: { sellingPriceMinor: cur.sellingPriceMinor, originalPriceMinor: cur.originalPriceMinor },
          after: { sellingPriceMinor: fields.sellingPriceMinor ?? cur.sellingPriceMinor, originalPriceMinor: fields.originalPriceMinor ?? cur.originalPriceMinor },
        });
      }
      const nonPrice = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'sellingPriceMinor' && k !== 'originalPriceMinor'));
      if (Object.keys(nonPrice).length) {
        await this.audit.record(tx, {
          actorId: user.id, action: 'copy.update', entityType: 'copy', entityId: id, ip,
          before: Object.fromEntries(Object.keys(nonPrice).map((k) => [k, (cur as Record<string, unknown>)[k]])), after: nonPrice,
        });
      }
      afterCommit(() => this.events.publish({ name: 'inventory.changed', payload: { copyIds: [id], stallId: cur.currentStallId ?? undefined }, rooms: ['role:admin'] }));
      const [row] = await selectCopies(tx).where(eq(copies.id, id));
      return toCopyDto(row!);
    });
  }

  // ───────────────────────── write-off ─────────────────────────

  async writeOff(actorId: string, id: string, body: WriteOffBody, ip?: string): Promise<CopyDto> {
    return this.txr.run(async (tx, afterCommit) => {
      const [cur] = await tx.select().from(copies).where(eq(copies.id, id)).for('update');
      if (!cur) throw new AppError('NOT_FOUND', 'Copy not found');
      if (cur.status !== 'IN_STOCK' && cur.status !== 'AT_STALL') {
        throw new AppError('COPY_NOT_AVAILABLE', 'Only copies in stock or at a stall can be written off', { codes: [cur.code] });
      }
      const [withLoc] = await selectCopies(tx).where(eq(copies.id, id));
      if (cur.status === 'AT_STALL') {
        await tx
          .update(stallMovements)
          .set({ outcome: 'LOST' })
          .where(and(eq(stallMovements.copyId, id), eq(stallMovements.outcome, 'OPEN')));
      }
      await tx
        .update(copies)
        .set({
          status: 'WRITTEN_OFF', writeoffReason: body.reason, rowId: null, slotNumber: null, currentStallId: null,
          lastLocationCode: locationOf(withLoc!) ?? cur.lastLocationCode,
          notes: body.notes ? [cur.notes, body.notes].filter(Boolean).join('\n') : cur.notes,
          version: sql`${copies.version} + 1`,
        })
        .where(eq(copies.id, id));
      await this.audit.record(tx, {
        actorId, action: 'copy.writeoff', entityType: 'copy', entityId: id, ip,
        before: { status: cur.status, location: locationOf(withLoc!) }, after: { status: 'WRITTEN_OFF', reason: body.reason, notes: body.notes },
      });
      afterCommit(() => this.events.publish({ name: 'inventory.changed', payload: { copyIds: [id], stallId: cur.currentStallId ?? undefined }, rooms: ['role:admin'] }));
      const [row] = await selectCopies(tx).where(eq(copies.id, id));
      return toCopyDto(row!);
    });
  }

  // ───────────────────────── move ─────────────────────────

  async move(actorId: string, id: string, body: MoveCopyBody, ip?: string): Promise<CopyDto> {
    return this.txr.run(async (tx, afterCommit) => {
      await this.alloc.lock(tx);
      const [cur] = await selectCopies(tx).where(eq(copies.id, id)).for('update', { of: copies });
      if (!cur) throw new AppError('NOT_FOUND', 'Copy not found');
      if (cur.copy.status !== 'IN_STOCK') {
        throw new AppError('COPY_NOT_AVAILABLE', 'Only copies in stock can be moved', { codes: [cur.copy.code] });
      }
      const [title] = await tx.select({ genreId: bookTitles.genreId }).from(bookTitles).where(eq(bookTitles.id, cur.copy.titleId));

      let target: { rowId: string; slot: number };
      if ('auto' in body) {
        const r = await this.alloc.allocate(tx, title!.genreId, 1, false);
        const p = r.placements[0];
        if (!p) throw new AppError('NO_SHELF_SPACE', 'There is no free shelf space for this genre');
        target = { rowId: p.rowId, slot: p.slot };
      } else {
        const [row] = await tx
          .select({ id: shelfRows.id, capacity: shelfRows.capacity, isActive: shelfRows.isActive })
          .from(shelfRows)
          .where(eq(shelfRows.id, body.rowId));
        if (!row || !row.isActive) throw new AppError('NOT_FOUND', 'Row not found');
        if (body.slot > row.capacity) throw new AppError('VALIDATION_FAILED', `That row only has ${row.capacity} slots`);
        const [taken] = await tx
          .select({ code: copies.code })
          .from(copies)
          .where(and(eq(copies.rowId, body.rowId), eq(copies.slotNumber, body.slot)));
        if (taken) throw new AppError('CONFLICT', `That slot is already taken by ${taken.code}`);
        target = { rowId: body.rowId, slot: body.slot };
      }

      await tx
        .update(copies)
        .set({ rowId: target.rowId, slotNumber: target.slot, labelNeedsPrint: true, version: sql`${copies.version} + 1` })
        .where(eq(copies.id, id));
      const [after] = await selectCopies(tx).where(eq(copies.id, id));
      const newLocation = locationOf(after!);
      await tx.update(copies).set({ lastLocationCode: newLocation }).where(eq(copies.id, id));
      await this.audit.record(tx, {
        actorId, action: 'copy.move', entityType: 'copy', entityId: id, ip,
        before: { location: locationOf(cur) }, after: { location: newLocation },
      });
      afterCommit(() => this.events.publish({ name: 'inventory.changed', payload: { copyIds: [id] }, rooms: ['role:admin'] }));
      return toCopyDto({ ...after!, copy: { ...after!.copy, lastLocationCode: newLocation } });
    });
  }
}
