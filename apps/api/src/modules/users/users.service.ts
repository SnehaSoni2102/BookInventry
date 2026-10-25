import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type {
  CreateUserBody, CreateUserResponse, ListUsersQuery, Page, ResetPasswordResponse, UpdateUserBody, UserDto,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { Db, Tx } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { refreshTokens, stallAssignments, stalls, users } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { EventBus } from '../../common/events/event-bus.js';
import { CredentialSlipService } from './credential-slip.service.js';
import { SessionCache } from '../auth/session-cache.service.js';

type UserRow = typeof users.$inferSelect;

export function toUserDto(u: UserRow, activeStall?: { id: string; name: string } | null): UserDto {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    ...(activeStall !== undefined ? { activeStall } : {}),
  };
}

const audited = (u: UserRow) => ({
  username: u.username, displayName: u.displayName, role: u.role, isActive: u.isActive,
});

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionCache) private readonly sessions: SessionCache,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CredentialSlipService) private readonly slips: CredentialSlipService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  async list(q: ListUsersQuery): Promise<Page<UserDto>> {
    const term = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : undefined;
    const where = and(
      q.role ? eq(users.role, q.role) : undefined,
      q.active === undefined ? undefined : eq(users.isActive, q.active),
      term ? or(ilike(users.username, term), ilike(users.displayName, term)) : undefined,
    );
    const rows = await this.db
      .select({ u: users, stallId: stalls.id, stallName: stalls.name })
      .from(users)
      .leftJoin(stallAssignments, and(eq(stallAssignments.userId, users.id), isNull(stallAssignments.unassignedAt)))
      .leftJoin(stalls, and(eq(stalls.id, stallAssignments.stallId), isNull(stalls.deletedAt)))
      .where(where)
      .orderBy(users.username)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(where);
    return {
      items: rows.map((r) => toUserDto(r.u, r.stallId ? { id: r.stallId, name: r.stallName! } : null)),
      page: q.page,
      pageSize: q.pageSize,
      total: n,
    };
  }

  async get(id: string): Promise<UserDto> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new AppError('NOT_FOUND', 'User not found');
    return toUserDto(u);
  }

  /** Creates a user inside the caller's transaction. Returns the row and the generated password, if any. */
  async createInTx(
    tx: Tx, actorId: string, body: CreateUserBody, ip?: string,
  ): Promise<{ row: UserRow; generated?: string }> {
    const generated = body.password ? undefined : this.passwords.generate();
    const passwordHash = await this.passwords.hash(body.password ?? generated!);
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.username, body.username));
    if (existing) throw new AppError('CONFLICT', 'That username is already taken');
    const [row] = await tx
      .insert(users)
      .values({ username: body.username, displayName: body.displayName, role: body.role, passwordHash, mustChangePassword: true })
      .returning();
    await this.audit.record(tx, { actorId, action: 'user.create', entityType: 'user', entityId: row!.id, after: audited(row!), ip });
    return { row: row!, generated };
  }

  /** The one-time credentials response (plaintext shown once, plus a printable-slip token). */
  credentialsResponse(row: UserRow, generated?: string): CreateUserResponse {
    return {
      user: toUserDto(row),
      ...(generated
        ? {
            initialPassword: generated,
            slipToken: this.slips.issue({ userId: row.id, username: row.username, displayName: row.displayName, password: generated }),
          }
        : {}),
    };
  }

  async create(actorId: string, body: CreateUserBody, ip?: string): Promise<CreateUserResponse> {
    const { row, generated } = await this.txr.run((tx) => this.createInTx(tx, actorId, body, ip));
    return this.credentialsResponse(row, generated);
  }

  async update(actorId: string, id: string, body: UpdateUserBody, ip?: string): Promise<UserDto> {
    const updated = await this.txr.run(async (tx, afterCommit) => {
      const [before] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!before) throw new AppError('NOT_FOUND', 'User not found');

      const losesAdmin =
        before.role === 'ADMIN' &&
        before.isActive &&
        ((body.role !== undefined && body.role !== 'ADMIN') || body.isActive === false);
      if (losesAdmin) {
        const others = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), ne(users.id, id)))
          .for('update');
        if (!others.length) throw new AppError('CONFLICT', 'There must be at least one active admin');
      }

      const sessionAffecting =
        (body.role !== undefined && body.role !== before.role) || (body.isActive === false && before.isActive);
      const [after] = await tx
        .update(users)
        .set({
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(sessionAffecting ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
        })
        .where(eq(users.id, id))
        .returning();
      if (body.isActive === false) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
      }
      await this.audit.record(tx, {
        actorId, action: 'user.update', entityType: 'user', entityId: id, before: audited(before), after: audited(after!), ip,
      });
      if (sessionAffecting) afterCommit(() => this.events.publish({ name: 'session.revoked', payload: {}, rooms: [`user:${id}`] }));
      return after!;
    });
    this.sessions.invalidate(id);
    return toUserDto(updated);
  }

  async resetPassword(actorId: string, id: string, ip?: string): Promise<ResetPasswordResponse> {
    const temporaryPassword = this.passwords.generate();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const updated = await this.txr.run(async (tx, afterCommit) => {
      const [after] = await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: true, tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, id))
        .returning();
      if (!after) throw new AppError('NOT_FOUND', 'User not found');
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
      await this.audit.record(tx, { actorId, action: 'user.password.reset', entityType: 'user', entityId: id, ip });
      afterCommit(() => this.events.publish({ name: 'session.revoked', payload: {}, rooms: [`user:${id}`] }));
      return after;
    });
    this.sessions.invalidate(id);
    const slipToken = this.slips.issue({ userId: id, username: updated.username, displayName: updated.displayName, password: temporaryPassword });
    return { user: toUserDto(updated), temporaryPassword, slipToken };
  }
}
