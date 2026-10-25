import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  can,
  type AssignManagerBody, type CloseStallBody, type CreateStallBody, type CreateStallResponse, type ListStallsQuery,
  type MovementDto, type MovementsQuery, type Page, type PaymentMethod, type Reconciliation, type StallDto,
  type UpdateStallBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/decorators/index.js';
import { EventBus } from '../../common/events/event-bus.js';
import { ScopeService } from '../../common/scope.js';
import type { Db, Q, Tx } from '../../db/client.js';
import { DB, TxRunner, type AfterCommit } from '../../db/db.module.js';
import {
  bookTitles, copies, refreshTokens, saleItems, sales, stallAssignments, stallMovements, stalls, users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionCache } from '../auth/session-cache.service.js';
import { locationOf, positionKey, selectCopies } from '../copies/copy-queries.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsersService } from '../users/users.service.js';

type StallRow = typeof stalls.$inferSelect;

@Injectable()
export class StallsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SessionCache) private readonly sessions: SessionCache,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  // ───────── reads ─────────

  async getRow(q: Q, id: string, opts: { includeDeleted?: boolean } = {}): Promise<StallRow> {
    const [row] = await q.select().from(stalls).where(and(eq(stalls.id, id), opts.includeDeleted ? undefined : isNull(stalls.deletedAt)));
    if (!row) throw new AppError('NOT_FOUND', 'Stall not found');
    return row;
  }

  private async toDtos(q: Q, rows: StallRow[]): Promise<StallDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [mgrs, out, sold] = await Promise.all([
      q
        .select({ stallId: stallAssignments.stallId, id: users.id, username: users.username, displayName: users.displayName, isActive: users.isActive })
        .from(stallAssignments)
        .innerJoin(users, eq(users.id, stallAssignments.userId))
        .where(and(inArray(stallAssignments.stallId, ids), isNull(stallAssignments.unassignedAt)))
        .orderBy(asc(users.username)),
      q
        .select({ stallId: copies.currentStallId, n: sql<number>`count(*)::int` })
        .from(copies)
        .where(and(inArray(copies.currentStallId, ids), eq(copies.status, 'AT_STALL')))
        .groupBy(copies.currentStallId),
      q
        .select({
          stallId: sales.stallId,
          items: sql<number>`count(${saleItems.id})::int`,
          revenue: sql<number>`coalesce(sum(${saleItems.soldPriceMinor}), 0)::int`,
        })
        .from(sales)
        .innerJoin(saleItems, eq(saleItems.saleId, sales.id))
        .where(and(inArray(sales.stallId, ids), eq(sales.status, 'COMPLETED')))
        .groupBy(sales.stallId),
    ]);
    return rows.map((r) => ({
      id: r.id,
      name: r.deletedAt ? `(deleted) ${r.name}` : r.name,
      location: r.location,
      description: r.description,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      status: r.status,
      activatedAt: r.activatedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      managers: mgrs.filter((m) => m.stallId === r.id).map(({ stallId: _s, ...m }) => m),
      counts: {
        atStall: out.find((o) => o.stallId === r.id)?.n ?? 0,
        sold: sold.find((s) => s.stallId === r.id)?.items ?? 0,
        revenueMinor: sold.find((s) => s.stallId === r.id)?.revenue ?? 0,
      },
    }));
  }

  async list(q: ListStallsQuery): Promise<StallDto[]> {
    const rows = await this.db
      .select()
      .from(stalls)
      .where(and(isNull(stalls.deletedAt), q.status ? eq(stalls.status, q.status) : undefined))
      .orderBy(desc(stalls.createdAt));
    return this.toDtos(this.db, rows);
  }

  async get(id: string): Promise<StallDto> {
    return (await this.toDtos(this.db, [await this.getRow(this.db, id)]))[0]!;
  }

  /** A manager's own stall (if any). */
  async mine(user: AuthUser): Promise<StallDto | null> {
    const id = await this.scope.activeStallId(user.id);
    return id ? this.get(id) : null;
  }

  /** Staff/admin may see any stall; a manager only their own. */
  async assertCanView(user: AuthUser, stallId: string): Promise<void> {
    if (can(user, 'stall.manage') || can(user, 'stall.checkout') || can(user, 'stall.checkin')) return;
    if ((await this.scope.activeStallId(user.id)) !== stallId) throw new AppError('NOT_FOUND', 'Stall not found');
  }

  // ───────── create / update / activate ─────────

  async create(actorId: string, body: CreateStallBody, ip?: string): Promise<CreateStallResponse> {
    const result = await this.txr.run(async (tx, afterCommit) => {
      const [dupe] = await tx.select({ id: stalls.id }).from(stalls).where(and(isNull(stalls.deletedAt), sql`lower(${stalls.name}) = lower(${body.name})`));
      if (dupe) throw new AppError('CONFLICT', 'A stall with that name already exists');
      const [stall] = await tx
        .insert(stalls)
        .values({
          name: body.name, location: body.location ?? null, description: body.description ?? null,
          startsOn: body.startsOn ?? null, endsOn: body.endsOn ?? null,
        })
        .returning();
      await this.audit.record(tx, { actorId, action: 'stall.create', entityType: 'stall', entityId: stall!.id, after: { name: stall!.name }, ip });

      let created: Awaited<ReturnType<UsersService['createInTx']>> | undefined;
      if (body.manager) {
        let managerId: string;
        if ('existingUserId' in body.manager) managerId = body.manager.existingUserId;
        else {
          created = await this.users.createInTx(tx, actorId, { username: body.manager.username, displayName: body.manager.displayName, role: 'STALL_MANAGER' }, ip);
          managerId = created.row.id;
        }
        await this.assignInTx(tx, actorId, stall!.id, managerId, false, ip);
      }
      afterCommit(() => this.publishStall(stall!.id));
      return { stallId: stall!.id, created };
    });
    return {
      stall: await this.get(result.stallId),
      ...(result.created ? { manager: this.users.credentialsResponse(result.created.row, result.created.generated) } : {}),
    };
  }

  async update(actorId: string, id: string, body: UpdateStallBody, ip?: string): Promise<StallDto> {
    await this.txr.run(async (tx, afterCommit) => {
      const [before] = await tx.select().from(stalls).where(and(eq(stalls.id, id), isNull(stalls.deletedAt))).for('update');
      if (!before) throw new AppError('NOT_FOUND', 'Stall not found');
      if (before.status === 'CLOSED') {
        const onlyNotes = Object.keys(body).every((k) => k === 'description');
        if (!onlyNotes) throw new AppError('CONFLICT', 'A closed stall can only have its notes edited');
      }
      if (body.name && body.name.toLowerCase() !== before.name.toLowerCase()) {
        const [dupe] = await tx.select({ id: stalls.id }).from(stalls)
          .where(and(isNull(stalls.deletedAt), ne(stalls.id, id), sql`lower(${stalls.name}) = lower(${body.name})`));
        if (dupe) throw new AppError('CONFLICT', 'A stall with that name already exists');
      }
      const startsOn = body.startsOn === undefined ? before.startsOn : body.startsOn;
      const endsOn = body.endsOn === undefined ? before.endsOn : body.endsOn;
      if (startsOn && endsOn && endsOn < startsOn) throw new AppError('VALIDATION_FAILED', 'endsOn must not be before startsOn');
      const [after] = await tx.update(stalls).set(body).where(eq(stalls.id, id)).returning();
      await this.audit.record(tx, { actorId, action: 'stall.update', entityType: 'stall', entityId: id, before: pick(before, body), after: pick(after!, body), ip });
      afterCommit(() => this.publishStall(id));
    });
    return this.get(id);
  }

  async activate(actorId: string, id: string, ip?: string): Promise<StallDto> {
    await this.txr.run(async (tx, afterCommit) => {
      const [before] = await tx.select().from(stalls).where(and(eq(stalls.id, id), isNull(stalls.deletedAt))).for('update');
      if (!before) throw new AppError('NOT_FOUND', 'Stall not found');
      if (before.status !== 'PLANNED') throw new AppError('CONFLICT', `Only a planned stall can be activated (this one is ${before.status})`);
      await tx.update(stalls).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(stalls.id, id));
      await this.audit.record(tx, { actorId, action: 'stall.activate', entityType: 'stall', entityId: id, before: { status: 'PLANNED' }, after: { status: 'ACTIVE' }, ip });
      afterCommit(() => this.publishStall(id));
    });
    return this.get(id);
  }

  // ───────── managers ─────────

  async assignInTx(tx: Tx, actorId: string, stallId: string, userId: string, moveFromOtherStall: boolean, ip?: string): Promise<void> {
    const [stall] = await tx.select().from(stalls).where(and(eq(stalls.id, stallId), isNull(stalls.deletedAt))).for('share');
    if (!stall) throw new AppError('NOT_FOUND', 'Stall not found');
    if (stall.status === 'CLOSED') throw new AppError('CONFLICT', 'Managers cannot be assigned to a closed stall');
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    if (user.role !== 'STALL_MANAGER') throw new AppError('VALIDATION_FAILED', 'Only stall-manager accounts can be assigned to a stall');
    if (!user.isActive) throw new AppError('VALIDATION_FAILED', 'This account is deactivated; reactivate it first');

    const [active] = await tx
      .select({ id: stallAssignments.id, stallId: stallAssignments.stallId, stallName: stalls.name })
      .from(stallAssignments)
      .innerJoin(stalls, eq(stalls.id, stallAssignments.stallId))
      .where(and(eq(stallAssignments.userId, userId), isNull(stallAssignments.unassignedAt)));
    if (active) {
      if (active.stallId === stallId) throw new AppError('CONFLICT', 'This manager is already assigned to the stall');
      if (!moveFromOtherStall) {
        throw new AppError('CONFLICT', `This manager is already active at "${active.stallName}"`, { stallId: active.stallId, stallName: active.stallName });
      }
      await tx.update(stallAssignments).set({ unassignedAt: new Date() }).where(eq(stallAssignments.id, active.id));
      await this.audit.record(tx, { actorId, action: 'stall.manager.unassign', entityType: 'stall', entityId: active.stallId, after: { userId, reason: 'moved' }, ip });
    }
    await tx.insert(stallAssignments).values({ stallId, userId });
    await this.audit.record(tx, { actorId, action: 'stall.manager.assign', entityType: 'stall', entityId: stallId, after: { userId, username: user.username }, ip });
  }

  async assign(actorId: string, stallId: string, body: AssignManagerBody, ip?: string): Promise<StallDto> {
    await this.txr.run(async (tx, afterCommit) => {
      await this.assignInTx(tx, actorId, stallId, body.userId, body.moveFromOtherStall, ip);
      afterCommit(() => this.publishStall(stallId));
    });
    return this.get(stallId);
  }

  async unassign(actorId: string, stallId: string, userId: string, ip?: string): Promise<StallDto> {
    await this.txr.run(async (tx, afterCommit) => {
      await this.getRow(tx, stallId);
      const ended = await tx
        .update(stallAssignments)
        .set({ unassignedAt: new Date() })
        .where(and(eq(stallAssignments.stallId, stallId), eq(stallAssignments.userId, userId), isNull(stallAssignments.unassignedAt)))
        .returning({ id: stallAssignments.id });
      if (!ended.length) throw new AppError('NOT_FOUND', 'That user is not assigned to this stall');
      await this.audit.record(tx, { actorId, action: 'stall.manager.unassign', entityType: 'stall', entityId: stallId, after: { userId }, ip });
      afterCommit(() => this.publishStall(stallId));
    });
    return this.get(stallId);
  }

  // ───────── delete (soft) ─────────

  async remove(actorId: string, id: string, ip?: string): Promise<void> {
    await this.txr.run(async (tx, afterCommit) => {
      const [stall] = await tx.select().from(stalls).where(and(eq(stalls.id, id), isNull(stalls.deletedAt))).for('update');
      if (!stall) throw new AppError('NOT_FOUND', 'Stall not found');
      const open = await tx
        .select({ code: copies.code })
        .from(stallMovements)
        .innerJoin(copies, eq(copies.id, stallMovements.copyId))
        .where(and(eq(stallMovements.stallId, id), eq(stallMovements.outcome, 'OPEN')));
      if (open.length) {
        throw new AppError('STALL_HAS_OPEN_CHECKOUTS', `${open.length} book(s) are still checked out to this stall; check them in or close the stall first`, {
          count: open.length, codes: open.slice(0, 20).map((o) => o.code),
        });
      }
      await tx.update(stalls).set({ deletedAt: new Date() }).where(eq(stalls.id, id));
      await tx.update(stallAssignments).set({ unassignedAt: new Date() }).where(and(eq(stallAssignments.stallId, id), isNull(stallAssignments.unassignedAt)));
      await this.audit.record(tx, { actorId, action: 'stall.delete', entityType: 'stall', entityId: id, before: { name: stall.name, status: stall.status }, ip });
      afterCommit(() => this.publishStall(id));
    });
  }

  // ───────── movements & reconciliation ─────────

  async movements(stallId: string, q: MovementsQuery): Promise<Page<MovementDto>> {
    await this.getRow(this.db, stallId, { includeDeleted: true });
    const where = and(eq(stallMovements.stallId, stallId), q.outcome ? eq(stallMovements.outcome, q.outcome) : undefined);
    const [rows, [{ n } = { n: 0 }]] = await Promise.all([
      this.db
        .select({
          m: stallMovements, code: copies.code, copyId: copies.id, title: bookTitles.title, by: users.displayName,
        })
        .from(stallMovements)
        .innerJoin(copies, eq(copies.id, stallMovements.copyId))
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .innerJoin(users, eq(users.id, stallMovements.checkedOutById))
        .where(where)
        .orderBy(desc(stallMovements.checkedOutAt), asc(copies.code))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(stallMovements).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.m.id, batchId: r.m.batchId, copy: { id: r.copyId, code: r.code, title: r.title },
        checkedOutAt: r.m.checkedOutAt.toISOString(), checkedOutBy: r.by,
        checkedInAt: r.m.checkedInAt?.toISOString() ?? null, outcome: r.m.outcome,
      })),
      page: q.page, pageSize: q.pageSize, total: n,
    };
  }

  async reconciliation(stallId: string, q: Q = this.db): Promise<Reconciliation> {
    const stall = await this.getRow(q, stallId, { includeDeleted: true });
    const counts = await q
      .select({ outcome: stallMovements.outcome, n: sql<number>`count(*)::int` })
      .from(stallMovements)
      .where(eq(stallMovements.stallId, stallId))
      .groupBy(stallMovements.outcome);
    const n = (o: string) => counts.find((c) => c.outcome === o)?.n ?? 0;

    const openRows = await selectCopies(q)
      .innerJoin(stallMovements, and(eq(stallMovements.copyId, copies.id), eq(stallMovements.outcome, 'OPEN'), eq(stallMovements.stallId, stallId)));
    const titles = openRows.length
      ? await q.select({ id: bookTitles.id, title: bookTitles.title }).from(bookTitles).where(inArray(bookTitles.id, [...new Set(openRows.map((r) => r.copy.titleId))]))
      : [];
    const stillOut = openRows
      .sort((a, b) => positionKey(a).localeCompare(positionKey(b)))
      .map((r) => ({
        copyId: r.copy.id, code: r.copy.code, title: titles.find((t) => t.id === r.copy.titleId)?.title ?? '',
        locationCode: locationOf(r), sellingPriceMinor: r.copy.sellingPriceMinor,
      }));

    const pay = await q
      .select({ method: sales.paymentMethod, total: sql<number>`sum(${sales.totalMinor})::int`, count: sql<number>`count(*)::int` })
      .from(sales)
      .where(and(eq(sales.stallId, stallId), eq(sales.status, 'COMPLETED')))
      .groupBy(sales.paymentMethod);
    const byPaymentMethod = { CASH: 0, UPI: 0, CARD: 0, OTHER: 0 } as Record<PaymentMethod, number>;
    for (const p of pay) byPaymentMethod[p.method] = p.total;

    return {
      stall: { id: stall.id, name: stall.deletedAt ? `(deleted) ${stall.name}` : stall.name, status: stall.status },
      sent: counts.reduce((a, c) => a + c.n, 0),
      sold: n('SOLD'), returned: n('RETURNED'), lost: n('LOST'),
      stillOut,
      revenueMinor: pay.reduce((a, p) => a + p.total, 0),
      salesCount: pay.reduce((a, p) => a + p.count, 0),
      byPaymentMethod,
    };
  }

  // ───────── close ─────────

  async close(actorId: string, id: string, body: CloseStallBody, ip?: string): Promise<Reconciliation> {
    const deactivate = await this.settings.get<boolean>('stall.deactivateManagersOnClose');
    const deactivated: string[] = [];
    await this.txr.run(async (tx, afterCommit) => {
      const [stall] = await tx.select().from(stalls).where(and(eq(stalls.id, id), isNull(stalls.deletedAt))).for('update');
      if (!stall) throw new AppError('NOT_FOUND', 'Stall not found');
      if (stall.status === 'CLOSED') throw new AppError('CONFLICT', 'This stall is already closed');

      let writtenOff: string[] = [];
      if (body.markRemainingAs === 'LOST') {
        const open = await selectCopies(tx)
          .innerJoin(stallMovements, and(eq(stallMovements.copyId, copies.id), eq(stallMovements.outcome, 'OPEN'), eq(stallMovements.stallId, id)))
          .orderBy(asc(copies.id))
          .for('update', { of: copies });
        for (const r of open) {
          await tx
            .update(copies)
            .set({
              status: 'WRITTEN_OFF', writeoffReason: 'LOST', rowId: null, slotNumber: null, currentStallId: null,
              lastLocationCode: locationOf(r) ?? r.copy.lastLocationCode, version: sql`${copies.version} + 1`,
            })
            .where(eq(copies.id, r.copy.id));
        }
        writtenOff = open.map((r) => r.copy.code);
        if (open.length) {
          await tx.update(stallMovements).set({ outcome: 'LOST' })
            .where(and(eq(stallMovements.stallId, id), eq(stallMovements.outcome, 'OPEN')));
        }
      }

      await tx.update(stalls).set({ status: 'CLOSED', closedAt: new Date() }).where(eq(stalls.id, id));
      const ended = await tx
        .update(stallAssignments)
        .set({ unassignedAt: new Date() })
        .where(and(eq(stallAssignments.stallId, id), isNull(stallAssignments.unassignedAt)))
        .returning({ userId: stallAssignments.userId });
      if (deactivate && ended.length) {
        const ids = ended.map((e) => e.userId);
        await tx.update(users).set({ isActive: false, tokenVersion: sql`${users.tokenVersion} + 1` }).where(inArray(users.id, ids));
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(inArray(refreshTokens.userId, ids), isNull(refreshTokens.revokedAt)));
        deactivated.push(...ids);
      }
      await this.audit.record(tx, {
        actorId, action: 'stall.close', entityType: 'stall', entityId: id, ip,
        before: { status: stall.status }, after: { status: 'CLOSED', markRemainingAs: body.markRemainingAs, writtenOff, managersDeactivated: deactivated },
      });
      afterCommit(() => {
        this.publishStall(id);
        if (writtenOff.length) this.events.publish({ name: 'inventory.changed', payload: { stallId: id }, rooms: ['role:admin', `stall:${id}`] });
        for (const uid of deactivated) this.events.publish({ name: 'session.revoked', payload: {}, rooms: [`user:${uid}`] });
      });
    });
    for (const uid of deactivated) this.sessions.invalidate(uid);
    return this.reconciliation(id);
  }

  publishStall(stallId: string, status?: string) {
    this.events.publish({ name: 'stall.updated', payload: { stallId, ...(status ? { status } : {}) }, rooms: ['role:admin', `stall:${stallId}`] });
  }
}

function pick<T extends object>(obj: T, keys: object): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(keys) as Array<keyof T>) out[k] = obj[k];
  return out;
}
