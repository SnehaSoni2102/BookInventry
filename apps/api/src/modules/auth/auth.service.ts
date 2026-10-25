import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  permissionsFor, type ChangePasswordBody, type LoginBody, type MeResponse, type SessionUser,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { refreshTokens, stallAssignments, stalls, users } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PasswordService } from './password.service.js';
import { SessionCache } from './session-cache.service.js';
import { TokenService } from './token.service.js';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SessionUser;
}

const FAILED_LOGIN_AUDIT_THRESHOLD = 3;

@Injectable()
export class AuthService {
  private readonly failures = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionCache) private readonly sessions: SessionCache,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  private toSessionUser(u: typeof users.$inferSelect): SessionUser {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      mustChangePassword: u.mustChangePassword,
    };
  }

  private async issue(u: typeof users.$inferSelect, familyId: string, userAgent?: string): Promise<IssuedSession> {
    const refresh = this.tokens.newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000);
    await this.db.insert(refreshTokens).values({
      userId: u.id,
      familyId,
      tokenHash: refresh.hash,
      userAgent: userAgent?.slice(0, 300),
      expiresAt: refreshExpiresAt,
    });
    const accessToken = await this.tokens.signAccess({ sub: u.id, role: u.role, tv: u.tokenVersion });
    return { accessToken, refreshToken: refresh.token, refreshExpiresAt, user: this.toSessionUser(u) };
  }

  async login(body: LoginBody, ctx: { ip?: string; userAgent?: string }): Promise<IssuedSession> {
    const [u] = await this.db.select().from(users).where(eq(users.username, body.username));
    const ok = u ? await this.passwords.verify(u.passwordHash, body.password) : (await this.passwords.verifyDummy(body.password), false);
    if (!u || !ok || !u.isActive) {
      const n = (this.failures.get(body.username) ?? 0) + 1;
      this.failures.set(body.username, n);
      if (n >= FAILED_LOGIN_AUDIT_THRESHOLD) {
        await this.audit.record(this.db, {
          actorId: u?.id ?? null,
          action: 'auth.login.failed',
          entityType: 'user',
          entityId: u?.id ?? body.username,
          after: { username: body.username, consecutiveFailures: n },
          ip: ctx.ip,
        });
      }
      throw new AppError('UNAUTHENTICATED', 'Invalid username or password');
    }
    this.failures.delete(body.username);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    return this.issue(u, randomUUID(), ctx.userAgent);
  }

  /** Rotates the refresh token. Presenting an already-rotated token revokes the whole family. */
  async refresh(token: string, ctx: { userAgent?: string }): Promise<IssuedSession> {
    const hash = TokenService.hashRefresh(token);
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
    if (!row) throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new AppError('UNAUTHENTICATED', 'Refresh token was already used; please sign in again');
    }
    if (row.expiresAt.getTime() < Date.now()) throw new AppError('UNAUTHENTICATED', 'Session expired');

    // Atomically claim the token so two concurrent refreshes cannot both succeed.
    const claimed = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (!claimed.length) {
      await this.revokeFamily(row.familyId);
      throw new AppError('UNAUTHENTICATED', 'Refresh token was already used; please sign in again');
    }

    const [u] = await this.db.select().from(users).where(eq(users.id, row.userId));
    if (!u || !u.isActive) throw new AppError('UNAUTHENTICATED', 'Account disabled');
    return this.issue(u, row.familyId, ctx.userAgent);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, TokenService.hashRefresh(token)), isNull(refreshTokens.revokedAt)));
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async me(userId: string): Promise<MeResponse> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw new AppError('UNAUTHENTICATED', 'Unknown user');
    const [stall] = await this.db
      .select({ id: stalls.id, name: stalls.name, status: stalls.status })
      .from(stallAssignments)
      .innerJoin(stalls, eq(stalls.id, stallAssignments.stallId))
      .where(and(eq(stallAssignments.userId, userId), isNull(stallAssignments.unassignedAt), isNull(stalls.deletedAt)));
    return {
      user: this.toSessionUser(u),
      permissions: permissionsFor(u.role),
      activeStall: stall ?? null,
      settings: await this.settings.clientSettings(),
    };
  }

  async changePassword(userId: string, body: ChangePasswordBody, ip?: string): Promise<IssuedSession> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u || !(await this.passwords.verify(u.passwordHash, body.currentPassword))) {
      throw new AppError('VALIDATION_FAILED', 'Current password is incorrect');
    }
    if (body.currentPassword === body.newPassword) {
      throw new AppError('VALIDATION_FAILED', 'New password must differ from the current one');
    }
    const passwordHash = await this.passwords.hash(body.newPassword);
    const [updated] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false, tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, userId))
        .returning();
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await this.audit.record(tx, { actorId: userId, action: 'user.password.change', entityType: 'user', entityId: userId, ip });
      return rows;
    });
    this.sessions.invalidate(userId);
    // Old tokens are invalid now; hand back a fresh session so the client stays signed in.
    return this.issue(updated!, randomUUID());
  }
}
