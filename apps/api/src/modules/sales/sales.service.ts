import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  can, normalizeText,
  type CreateSaleBody, type ListSalesQuery, type Page, type PaymentMethod, type SaleDto, type SaleListItem,
  type SalesSummary, type SalesSummaryQuery, type SummaryRow, type VoidSaleBody, type VoidSaleResponse,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/decorators/index.js';
import { EventBus } from '../../common/events/event-bus.js';
import { ScopeService } from '../../common/scope.js';
import type { Db, Q, Tx } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import {
  bookTitles, copies, genres, saleItems, sales, shelfRows, stallMovements, stalls, users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { locationOf, selectCopies, type CopyRow } from '../copies/copy-queries.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShelfAllocationService } from '../shelves/shelf-allocation.service.js';

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'OTHER'];
const emptyByMethod = () => ({ CASH: 0, UPI: 0, CARD: 0, OTHER: 0 }) as Record<PaymentMethod, number>;
const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&');

/** "FIC-A03-017" → row code "A03" + slot 17. Used to put a voided sale's book back where it was. */
export function parseLocationCode(code: string | null): { rowCode: string; slot: number } | null {
  const m = code ? /^[A-Z]{2,4}-([A-Z]{1,2}\d{2})-(\d{3})$/.exec(code) : null;
  return m ? { rowCode: m[1]!, slot: Number(m[2]) } : null;
}

/** The "Sold at" column: central → "Admin"; admin selling out of a stall → "Admin @ stall"; otherwise the stall. */
export function soldAtLabel(stall: { name: string; deleted: boolean } | null, sellerRole: string): string {
  if (!stall) return 'Admin';
  const name = stall.deleted ? `(deleted) ${stall.name}` : stall.name;
  return sellerRole === 'ADMIN' ? `Admin @ ${name}` : name;
}

@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ShelfAllocationService) private readonly alloc: ShelfAllocationService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  // ───────────────────────── create ─────────────────────────

  async create(user: AuthUser, body: CreateSaleBody, ip?: string): Promise<SaleDto> {
    const wholeStall = await this.settings.get<boolean>('sales.managerSeesWholeStall');
    return this.txr.run(async (tx, afterCommit) => {
      const replay = await this.replayIfSeen(tx, body.clientRef, user);
      if (replay) return replay;

      const ids = body.items.map((i) => i.copyId);
      if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_FAILED', 'The same copy appears twice in this sale');

      const rows = await selectCopies(tx).where(inArray(copies.id, ids)).orderBy(asc(copies.id)).for('update', { of: copies });
      // A concurrent request with the same clientRef may have committed while we waited for the locks.
      const replayAfterLock = await this.replayIfSeen(tx, body.clientRef, user);
      if (replayAfterLock) return replayAfterLock;

      const byId = new Map(rows.map((r) => [r.copy.id, r]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) throw new AppError('NOT_FOUND', 'Some copies were not found', { copyIds: missing });

      const isAdminSeller = can(user, 'sale.create.central');
      let stallId: string | null = null;

      if (!isAdminSeller) {
        // Stall manager: only copies at their own ACTIVE stall.
        stallId = await this.scope.activeStallId(user.id, tx);
        if (!stallId) throw new AppError('STALL_NOT_ACTIVE', 'You are not assigned to an active stall');
        const [stall] = await tx.select({ status: stalls.status }).from(stalls).where(eq(stalls.id, stallId));
        if (stall?.status !== 'ACTIVE') throw new AppError('STALL_NOT_ACTIVE', 'Your stall is not open for sales');
        const bad = rows.filter((r) => r.copy.status !== 'AT_STALL' || r.copy.currentStallId !== stallId);
        if (bad.length) throw new AppError('COPY_NOT_AT_YOUR_STALL', 'Some books are not at your stall', { codes: bad.map((b) => b.copy.code) });
      } else {
        const bad = rows.filter((r) => r.copy.status !== 'IN_STOCK' && r.copy.status !== 'AT_STALL');
        if (bad.length) throw new AppError('COPY_NOT_AVAILABLE', 'Some books are no longer available', { codes: bad.map((b) => b.copy.code) });
        const origins = new Set(rows.map((r) => r.copy.currentStallId ?? 'central'));
        if (origins.size > 1) throw new AppError('VALIDATION_FAILED', 'A sale cannot mix central stock with stall stock, or books from different stalls');
        stallId = rows[0]!.copy.currentStallId;
        if (stallId && !body.confirmAtStallCopies) {
          const [stall] = await tx.select({ id: stalls.id, name: stalls.name }).from(stalls).where(eq(stalls.id, stallId));
          throw new AppError('COPY_NOT_AVAILABLE', `These books are at "${stall?.name}"; confirm to record the sale against that stall`, {
            requiresConfirm: 'COPY_AT_STALL', stall, codes: rows.map((r) => r.copy.code),
          });
        }
      }

      // Pricing (D7): only an admin may deviate from the listed price.
      const priced = body.items.map((i) => {
        const r = byId.get(i.copyId)!;
        const list = r.copy.sellingPriceMinor;
        const sold = i.soldPriceMinor ?? list;
        if (sold !== list && !isAdminSeller) {
          throw new AppError('DISCOUNT_NOT_ALLOWED', 'Stall managers cannot change the price', { code: r.copy.code, listPriceMinor: list });
        }
        return { row: r, list, sold };
      });
      const total = priced.reduce((a, p) => a + p.sold, 0);

      const receiptNo = (await tx.execute<{ r: string }>(sql`SELECT 'R-' || lpad(nextval('receipt_seq')::text, 6, '0') AS r`)).rows[0]!.r;
      const [sale] = await tx
        .insert(sales)
        .values({
          receiptNo, stallId, soldById: user.id, paymentMethod: body.paymentMethod, totalMinor: total,
          customerName: body.customerName ?? null, customerPhone: body.customerPhone ?? null, notes: body.notes ?? null,
          clientRef: body.clientRef,
        })
        .returning();
      await tx.insert(saleItems).values(priced.map((p) => ({ saleId: sale!.id, copyId: p.row.copy.id, listPriceMinor: p.list, soldPriceMinor: p.sold })));

      const copyIds = priced.map((p) => p.row.copy.id);
      for (const p of priced) {
        await tx
          .update(copies)
          .set({
            status: 'SOLD', soldAt: sale!.soldAt, lastLocationCode: locationOf(p.row) ?? p.row.copy.lastLocationCode,
            rowId: null, slotNumber: null, currentStallId: null, version: sql`${copies.version} + 1`,
          })
          .where(eq(copies.id, p.row.copy.id));
      }
      await tx.update(stallMovements).set({ outcome: 'SOLD' }).where(and(inArray(stallMovements.copyId, copyIds), eq(stallMovements.outcome, 'OPEN')));

      await this.audit.record(tx, {
        actorId: user.id, action: 'sale.create', entityType: 'sale', entityId: sale!.id, ip,
        after: { receiptNo, totalMinor: total, stallId, paymentMethod: body.paymentMethod, codes: priced.map((p) => p.row.copy.code) },
      });
      for (const p of priced.filter((x) => x.sold !== x.list)) {
        await this.audit.record(tx, {
          actorId: user.id, action: 'sale.price.override', entityType: 'copy', entityId: p.row.copy.id, ip,
          before: { sellingPriceMinor: p.list }, after: { soldPriceMinor: p.sold, receiptNo },
        });
      }

      const dto = await this.loadOne(tx, sale!.id);
      afterCommit(() => {
        const rooms = ['role:admin', `user:${user.id}`, ...(wholeStall && stallId ? [`stall:${stallId}`] : [])];
        this.events.publish({
          name: 'sale.created',
          payload: { saleId: sale!.id, stallId, totalMinor: total, itemsCount: copyIds.length, soldAt: sale!.soldAt.toISOString() },
          rooms,
        });
        this.events.publish({ name: 'inventory.changed', payload: { copyIds, ...(stallId ? { stallId } : {}) }, rooms: ['role:admin', ...(stallId ? [`stall:${stallId}`] : [])] });
      });
      return dto;
    });
  }

  /** Same clientRef → same sale. A different user presenting someone else's clientRef is refused. */
  private async replayIfSeen(tx: Tx, clientRef: string, user: AuthUser): Promise<SaleDto | null> {
    const [existing] = await tx.select({ id: sales.id, soldById: sales.soldById }).from(sales).where(eq(sales.clientRef, clientRef));
    if (!existing) return null;
    if (existing.soldById !== user.id) throw new AppError('CONFLICT', 'This request id (clientRef) was already used by a different request');
    return this.loadOne(tx, existing.id);
  }

  // ───────────────────────── read ─────────────────────────

  /** Who may see which sales (D6): admins all; managers their own, or their whole stall if the setting says so. */
  private async visibility(user: AuthUser, q: Q = this.db): Promise<SQL | undefined> {
    if (can(user, 'sale.read.all')) return undefined;
    if (!can(user, 'sale.read.own')) throw new AppError('FORBIDDEN', 'You may not view sales');
    const wholeStall = await this.settings.get<boolean>('sales.managerSeesWholeStall', q);
    const stallId = wholeStall ? await this.scope.activeStallId(user.id, q) : null;
    return stallId ? or(eq(sales.soldById, user.id), eq(sales.stallId, stallId)) : eq(sales.soldById, user.id);
  }

  private dateConds(from: string | undefined, to: string | undefined, tz: string): SQL[] {
    const conds: SQL[] = [];
    const dateOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (from) conds.push(dateOnly(from) ? sql`${sales.soldAt} >= (${from}::date)::timestamp AT TIME ZONE ${tz}` : sql`${sales.soldAt} >= ${new Date(from)}`);
    if (to) conds.push(dateOnly(to) ? sql`${sales.soldAt} < ((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}` : sql`${sales.soldAt} <= ${new Date(to)}`);
    return conds;
  }

  private async filters(user: AuthUser, q: Omit<ListSalesQuery, 'page' | 'pageSize'>): Promise<SQL | undefined> {
    const tz = await this.settings.get<string>('org.timezone');
    const term = q.q ? `%${escapeLike(q.q)}%` : undefined;
    const norm = q.q ? normalizeText(q.q) : '';
    return and(
      await this.visibility(user),
      q.stallId ? eq(sales.stallId, q.stallId) : undefined,
      q.central === true ? sql`${sales.stallId} IS NULL` : q.central === false ? sql`${sales.stallId} IS NOT NULL` : undefined,
      q.sellerId ? eq(sales.soldById, q.sellerId) : undefined,
      q.paymentMethod ? eq(sales.paymentMethod, q.paymentMethod) : undefined,
      q.status ? eq(sales.status, q.status) : undefined,
      ...this.dateConds(q.from, q.to, tz),
      term
        ? or(
            sql`${sales.receiptNo} ILIKE ${term}`,
            sql`EXISTS (SELECT 1 FROM ${saleItems} si JOIN ${copies} c ON c.id = si.copy_id JOIN ${bookTitles} t ON t.id = c.title_id
                WHERE si.sale_id = ${sales.id} AND (c.code ILIKE ${term} ${norm ? sql`OR t.search_text ILIKE ${`%${escapeLike(norm)}%`}` : sql``}))`,
          )
        : undefined,
    );
  }

  private listQuery(q: Q) {
    return q
      .select({
        sale: sales,
        stallName: stalls.name,
        stallDeleted: sql<boolean>`${stalls.deletedAt} IS NOT NULL`,
        sellerName: users.displayName,
        sellerRole: users.role,
        itemsCount: sql<number>`(SELECT count(*)::int FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id})`,
      })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.soldById))
      .leftJoin(stalls, eq(stalls.id, sales.stallId));
  }

  private toListItem(r: Awaited<ReturnType<SalesService['listQuery']>>[number]): SaleListItem {
    const s = r.sale;
    return {
      id: s.id, receiptNo: s.receiptNo, soldAt: s.soldAt.toISOString(), stallId: s.stallId,
      soldAtLabel: soldAtLabel(s.stallId ? { name: r.stallName!, deleted: r.stallDeleted } : null, r.sellerRole),
      seller: { id: s.soldById, displayName: r.sellerName }, itemsCount: r.itemsCount, totalMinor: s.totalMinor,
      paymentMethod: s.paymentMethod, status: s.status,
    };
  }

  async list(user: AuthUser, q: ListSalesQuery): Promise<Page<SaleListItem>> {
    const where = await this.filters(user, q);
    const [rows, [{ n } = { n: 0 }]] = await Promise.all([
      this.listQuery(this.db).where(where).orderBy(desc(sales.soldAt), desc(sales.receiptNo)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(sales).where(where),
    ]);
    return { items: rows.map((r) => this.toListItem(r)), page: q.page, pageSize: q.pageSize, total: n };
  }

  async loadOne(q: Q, id: string): Promise<SaleDto> {
    const [r] = await this.listQuery(q).where(eq(sales.id, id));
    if (!r) throw new AppError('NOT_FOUND', 'Sale not found');
    const items = await q
      .select({ item: saleItems, code: copies.code, condition: copies.condition, title: bookTitles.title })
      .from(saleItems)
      .innerJoin(copies, eq(copies.id, saleItems.copyId))
      .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
      .where(eq(saleItems.saleId, id))
      .orderBy(asc(copies.code));
    const voidedBy = r.sale.voidedById
      ? ((await q.select({ name: users.displayName }).from(users).where(eq(users.id, r.sale.voidedById)))[0]?.name ?? null)
      : null;
    return {
      ...this.toListItem(r),
      customerName: r.sale.customerName, customerPhone: r.sale.customerPhone, notes: r.sale.notes,
      items: items.map((i) => ({
        copyId: i.item.copyId, code: i.code, title: i.title, condition: i.condition,
        listPriceMinor: i.item.listPriceMinor, soldPriceMinor: i.item.soldPriceMinor,
      })),
      voidedAt: r.sale.voidedAt?.toISOString() ?? null, voidReason: r.sale.voidReason, voidedBy,
    };
  }

  /** A sale the caller may not see is reported as not found. */
  async get(user: AuthUser, id: string): Promise<SaleDto> {
    const visible = await this.visibility(user);
    const [ok] = await this.db.select({ id: sales.id }).from(sales).where(and(eq(sales.id, id), visible));
    if (!ok) throw new AppError('NOT_FOUND', 'Sale not found');
    return this.loadOne(this.db, id);
  }

  async exportRows(user: AuthUser, q: Omit<ListSalesQuery, 'page' | 'pageSize'>): Promise<SaleDto[]> {
    const where = await this.filters(user, q);
    const ids = await this.db.select({ id: sales.id }).from(sales).where(where).orderBy(desc(sales.soldAt)).limit(20_000);
    const out: SaleDto[] = [];
    for (const { id } of ids) out.push(await this.loadOne(this.db, id));
    return out;
  }

  // ───────────────────────── void ─────────────────────────

  async void(user: AuthUser, saleId: string, body: VoidSaleBody, ip?: string): Promise<VoidSaleResponse> {
    const wholeStall = await this.settings.get<boolean>('sales.managerSeesWholeStall');
    return this.txr.run(async (tx, afterCommit) => {
      await this.alloc.lock(tx); // restoring books may allocate shelf slots
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).for('update');
      if (!sale) throw new AppError('NOT_FOUND', 'Sale not found');
      if (sale.status !== 'COMPLETED') throw new AppError('CONFLICT', 'This sale is already voided');

      let returnStallId: string | null = null;
      if (body.returnToStall) {
        if (!sale.stallId) throw new AppError('VALIDATION_FAILED', 'This was a central sale; there is no stall to return the books to');
        const [stall] = await tx.select().from(stalls).where(eq(stalls.id, sale.stallId));
        if (!stall || stall.deletedAt || stall.status !== 'ACTIVE') throw new AppError('STALL_NOT_ACTIVE', 'That stall is no longer active; restore the books to the central shelf instead');
        returnStallId = stall.id;
      }

      const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, saleId));
      const rows = await selectCopies(tx).where(inArray(copies.id, items.map((i) => i.copyId))).orderBy(asc(copies.id)).for('update', { of: copies });
      const notSold = rows.filter((r) => r.copy.status !== 'SOLD');
      if (notSold.length) throw new AppError('CONFLICT', 'Some books from this sale have since been changed and cannot be restored', { codes: notSold.map((r) => r.copy.code) });

      const restored: VoidSaleResponse['restored'] = [];
      const relocatedIds: string[] = [];
      const batchId = crypto.randomUUID();
      for (const r of rows) {
        const [bt] = await tx.select({ title: bookTitles.title, genreId: bookTitles.genreId }).from(bookTitles).where(eq(bookTitles.id, r.copy.titleId));
        const place = await this.placeForRestore(tx, r, bt!.genreId);
        await tx
          .update(copies)
          .set({
            status: returnStallId ? 'AT_STALL' : 'IN_STOCK', currentStallId: returnStallId, soldAt: null,
            rowId: place.rowId, slotNumber: place.slot, lastLocationCode: place.locationCode ?? r.copy.lastLocationCode,
            ...(place.relocated ? { labelNeedsPrint: true } : {}), version: sql`${copies.version} + 1`,
          })
          .where(eq(copies.id, r.copy.id));
        if (returnStallId) {
          await tx.insert(stallMovements).values({ copyId: r.copy.id, stallId: returnStallId, batchId, checkedOutById: user.id });
        }
        if (place.relocated) relocatedIds.push(r.copy.id);
        restored.push({ code: r.copy.code, title: bt!.title, locationCode: place.locationCode, relocated: place.relocated });
      }

      await tx
        .update(sales)
        .set({ status: 'VOIDED', voidedAt: new Date(), voidedById: user.id, voidReason: body.reason })
        .where(eq(sales.id, saleId));
      await this.audit.record(tx, {
        actorId: user.id, action: 'sale.void', entityType: 'sale', entityId: saleId, ip,
        before: { status: 'COMPLETED', totalMinor: sale.totalMinor },
        after: { status: 'VOIDED', reason: body.reason, returnToStall: Boolean(returnStallId), restored },
      });

      const dto = await this.loadOne(tx, saleId);
      const copyIds = rows.map((r) => r.copy.id);
      afterCommit(() => {
        const rooms = ['role:admin', `user:${sale.soldById}`, ...(wholeStall && sale.stallId ? [`stall:${sale.stallId}`] : [])];
        this.events.publish({
          name: 'sale.voided',
          payload: { saleId, stallId: sale.stallId, totalMinor: sale.totalMinor, itemsCount: copyIds.length, soldAt: sale.soldAt.toISOString() },
          rooms,
        });
        this.events.publish({ name: 'inventory.changed', payload: { copyIds, ...(sale.stallId ? { stallId: sale.stallId } : {}) }, rooms: ['role:admin', ...(sale.stallId ? [`stall:${sale.stallId}`] : [])] });
      });
      return {
        sale: dto,
        restored,
        labelPdfUrl: relocatedIds.length ? `/api/v1/labels/pdf?copyIds=${relocatedIds.join(',')}` : null,
      };
    });
  }

  /** Original slot if it is still free (and its row still exists), otherwise a freshly allocated one. */
  private async placeForRestore(tx: Tx, r: CopyRow, genreId: string) {
    const parsed = parseLocationCode(r.copy.lastLocationCode);
    if (parsed) {
      const [row] = await tx.select({ id: shelfRows.id, capacity: shelfRows.capacity }).from(shelfRows)
        .where(and(eq(shelfRows.code, parsed.rowCode), eq(shelfRows.isActive, true)));
      if (row && parsed.slot <= row.capacity) {
        const [taken] = await tx.select({ id: copies.id }).from(copies).where(and(eq(copies.rowId, row.id), eq(copies.slotNumber, parsed.slot)));
        if (!taken) return { rowId: row.id, slot: parsed.slot, locationCode: r.copy.lastLocationCode, relocated: false };
      }
    }
    const a = await this.alloc.allocate(tx, genreId, 1, false);
    const p = a.placements[0];
    return p
      ? { rowId: p.rowId, slot: p.slot, locationCode: p.locationCode, relocated: true }
      : { rowId: null, slot: null, locationCode: null, relocated: true }; // no space: back in stock, unshelved
  }

  // ───────────────────────── summary ─────────────────────────

  async summary(user: AuthUser, q: SalesSummaryQuery): Promise<SalesSummary> {
    const tz = await this.settings.get<string>('org.timezone');
    const base = and(
      eq(sales.status, 'COMPLETED'),
      await this.visibility(user),
      ...this.dateConds(q.from, q.to, tz),
    );
    const itemCount = sql<number>`(SELECT count(*)::int FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id})`;

    type Agg = { key: string; label: string; method: PaymentMethod; salesCount: number; itemsCount: number; revenue: number };
    let agg: Agg[];
    if (q.groupBy === 'genre') {
      agg = (await this.db
        .select({
          key: genres.code, label: genres.name, method: sales.paymentMethod,
          salesCount: sql<number>`count(DISTINCT ${sales.id})::int`, itemsCount: sql<number>`count(${saleItems.id})::int`,
          revenue: sql<number>`coalesce(sum(${saleItems.soldPriceMinor}), 0)::int`,
        })
        .from(sales)
        .innerJoin(saleItems, eq(saleItems.saleId, sales.id))
        .innerJoin(copies, eq(copies.id, saleItems.copyId))
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .innerJoin(genres, eq(genres.id, bookTitles.genreId))
        .where(base)
        .groupBy(genres.code, genres.name, sales.paymentMethod)) as Agg[];
    } else {
      const keyExpr =
        q.groupBy === 'stall' ? sql<string>`coalesce(${sales.stallId}::text, 'central')`
        : q.groupBy === 'day' ? sql<string>`to_char((${sales.soldAt} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`
        : sql<string>`${sales.paymentMethod}::text`;
      agg = (await this.db
        .select({
          key: keyExpr, method: sales.paymentMethod,
          salesCount: sql<number>`count(*)::int`, itemsCount: sql<number>`coalesce(sum(${itemCount}), 0)::int`,
          revenue: sql<number>`coalesce(sum(${sales.totalMinor}), 0)::int`,
        })
        .from(sales)
        .where(base)
        .groupBy(sql`1`, sales.paymentMethod)).map((a) => ({ ...a, label: a.key })) as Agg[]; // by position: the day expression carries a bind parameter (time zone), which Postgres will not match to the SELECT copy
    }

    const rows = new Map<string, SummaryRow>();
    const row = (key: string, label: string): SummaryRow => {
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { key, label, salesCount: 0, itemsCount: 0, revenueMinor: 0, byPaymentMethod: emptyByMethod() }));
      return r;
    };
    for (const a of agg) {
      const r = row(a.key, a.label);
      r.salesCount += a.salesCount;
      r.itemsCount += a.itemsCount;
      r.revenueMinor += a.revenue;
      r.byPaymentMethod[a.method] += a.revenue;
    }

    if (q.groupBy === 'stall') {
      // One card per active stall (even with no sales yet) plus the central "Admin" row.
      row('central', 'Admin (central)').label = 'Admin (central)';
      const stallRows = await this.db.select({ id: stalls.id, name: stalls.name, status: stalls.status, deleted: stalls.deletedAt }).from(stalls);
      const visibleKeys = new Set(rows.keys());
      for (const s of stallRows) {
        const hasSales = visibleKeys.has(s.id);
        if (hasSales) rows.get(s.id)!.label = s.deleted ? `(deleted) ${s.name}` : s.name;
        else if (s.status === 'ACTIVE' && !s.deleted && can(user, 'sale.read.all')) row(s.id, s.name);
      }
    } else if (q.groupBy === 'paymentMethod') {
      for (const m of PAYMENT_METHODS) row(m, m);
    }

    let ordered = [...rows.values()];
    ordered = q.groupBy === 'day'
      ? ordered.sort((a, b) => b.key.localeCompare(a.key))
      : q.groupBy === 'paymentMethod'
        ? ordered.sort((a, b) => PAYMENT_METHODS.indexOf(a.key as PaymentMethod) - PAYMENT_METHODS.indexOf(b.key as PaymentMethod))
        : ordered.sort((a, b) => (a.key === 'central' ? -1 : b.key === 'central' ? 1 : b.revenueMinor - a.revenueMinor || a.label.localeCompare(b.label)));

    const total: SummaryRow = { key: 'total', label: 'Total', salesCount: 0, itemsCount: 0, revenueMinor: 0, byPaymentMethod: emptyByMethod() };
    for (const r of ordered) {
      total.salesCount += r.salesCount;
      total.itemsCount += r.itemsCount;
      total.revenueMinor += r.revenueMinor;
      for (const m of PAYMENT_METHODS) total.byPaymentMethod[m] += r.byPaymentMethod[m];
    }
    return { groupBy: q.groupBy, rows: ordered, total };
  }
}
