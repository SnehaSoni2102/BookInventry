import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, refreshTokens, users } from '../src/db/schema/index.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('login', () => {
  it('rejects bad credentials with a generic error', async () => {
    const bad = await ctx.login('admin', 'wrong-password');
    const unknown = await ctx.login('nobody', 'wrong-password');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
    expect(unknown.body).toEqual(bad.body);
  });

  it('web clients get an httpOnly refresh cookie and no refresh token in the body', async () => {
    const res = await ctx.login('admin', 'Admin-Pass-1', 'web');
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/refresh_token=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('mobile clients get the refresh token in the body', async () => {
    const res = await ctx.login('admin', 'Admin-Pass-1', 'mobile');
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('never exposes the password hash', async () => {
    const res = await ctx.login('admin', 'Admin-Pass-1');
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);
  });
});

describe('must-change-password gate', () => {
  it('blocks everything except me / change-password / logout until changed', async () => {
    const login = await ctx.login('admin', 'Admin-Pass-1');
    expect(login.body.mustChangePassword).toBe(true);
    const h = bearer(login.body.accessToken);

    const blocked = await ctx.http().get('/api/v1/users').set(h);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await ctx.http().get('/api/v1/auth/me').set(h)).status).toBe(200);

    const weak = await ctx.http().post('/api/v1/auth/change-password').set(h)
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'password123' });
    expect(weak.status).toBe(400);

    const changed = await ctx.http().post('/api/v1/auth/change-password').set(h)
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' });
    expect(changed.status).toBe(200);
    expect(changed.body.mustChangePassword).toBe(false);

    // the old token is dead (token_version bumped); the new one works
    expect((await ctx.http().get('/api/v1/users').set(h)).status).toBe(401);
    expect((await ctx.http().get('/api/v1/users').set(bearer(changed.body.accessToken))).status).toBe(200);
    expect((await ctx.login('admin', 'Admin-Pass-1')).status).toBe(401);
    expect((await ctx.login('admin', 'Brand-New-Pass-9')).status).toBe(200);
  });
});

describe('refresh rotation', () => {
  it('rotates, and reuse of a spent token revokes the whole family', async () => {
    const login = await ctx.login('admin', 'Brand-New-Pass-9');
    const t1 = login.body.refreshToken as string;

    const r1 = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: t1 });
    expect(r1.status).toBe(200);
    const t2 = r1.body.refreshToken as string;
    expect(t2).not.toBe(t1);

    // theft: attacker replays t1
    const replay = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: t1 });
    expect(replay.status).toBe(401);

    // the legitimate holder's newest token is now dead too
    const after = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: t2 });
    expect(after.status).toBe(401);
  });

  it('logout revokes the refresh token; the web cookie flow works', async () => {
    const agent = ctx.http();
    const login = await ctx.login('admin', 'Brand-New-Pass-9', 'web');
    const cookie = login.headers['set-cookie'] as unknown as string[];
    const ok = await agent.post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    expect(ok.status).toBe(200);
    const newCookie = ok.headers['set-cookie'] as unknown as string[];
    const out = await ctx.http().post('/api/v1/auth/logout').set('Cookie', newCookie).send({});
    expect(out.status).toBe(204);
    expect((await ctx.http().post('/api/v1/auth/refresh').set('Cookie', newCookie).send({})).status).toBe(401);
  });
});

describe('RBAC and user management', () => {
  let adminToken: string;
  beforeAll(async () => {
    adminToken = (await ctx.login('admin', 'Brand-New-Pass-9')).body.accessToken;
  });

  it('only users with user.manage can manage users', async () => {
    const staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
    const mgr = await ctx.userToken('mgr0', 'STALL_MANAGER');
    for (const token of [staff, mgr]) {
      const res = await ctx.http().get('/api/v1/users').set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await ctx.http().get('/api/v1/audit-logs').set(bearer(staff))).status).toBe(403);
    expect((await ctx.http().get('/api/v1/users')).status).toBe(401);
  });

  it('admin creates a stall manager (password shown once) and can reset it', async () => {
    const created = await ctx.http().post('/api/v1/users').set(bearer(adminToken))
      .send({ username: 'Mgr.One', displayName: 'Manager One', role: 'STALL_MANAGER' });
    expect(created.status).toBe(201);
    expect(created.body.initialPassword).toMatch(/^[A-Za-z2-9]{10}$/);
    expect(created.body.user.username).toBe('mgr.one');
    expect(JSON.stringify(created.body)).not.toMatch(/argon2/);

    // can sign in, but must change the password first
    const first = await ctx.login('mgr.one', created.body.initialPassword);
    expect(first.status).toBe(200);
    expect(first.body.mustChangePassword).toBe(true);

    const dup = await ctx.http().post('/api/v1/users').set(bearer(adminToken))
      .send({ username: 'mgr.one', displayName: 'x', role: 'STALL_MANAGER' });
    expect(dup.status).toBe(409);

    const reset = await ctx.http().post(`/api/v1/users/${created.body.user.id}/reset-password`).set(bearer(adminToken));
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).not.toBe(created.body.initialPassword);
    // the old session and old password are dead, the new password works
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(first.body.accessToken))).status).toBe(401);
    expect((await ctx.login('mgr.one', created.body.initialPassword)).status).toBe(401);
    expect((await ctx.login('mgr.one', reset.body.temporaryPassword)).status).toBe(200);

    const me = await ctx.http().get('/api/v1/auth/me').set(bearer((await ctx.login('mgr.one', reset.body.temporaryPassword)).body.accessToken));
    expect(me.body.permissions).toContain('sale.create.stall');
    expect(me.body.permissions).not.toContain('stall.checkout');
    expect(me.body.activeStall).toBeNull();
  });

  it('a deactivated user is rejected immediately', async () => {
    const token = await ctx.userToken('temp1', 'INVENTORY_STAFF');
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(token))).status).toBe(200);
    const [u] = await ctx.t.db.select().from(users).where(eq(users.username, 'temp1'));
    const res = await ctx.http().patch(`/api/v1/users/${u!.id}`).set(bearer(adminToken)).send({ isActive: false });
    expect(res.status).toBe(200);
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
    expect((await ctx.login('temp1', 'Test-Pass-123')).status).toBe(401);
    const tokens = await ctx.t.db.select().from(refreshTokens).where(eq(refreshTokens.userId, u!.id));
    expect(tokens.every((t) => t.revokedAt)).toBe(true);
  });

  it('cannot demote or deactivate the last active admin', async () => {
    const [admin] = await ctx.t.db.select().from(users).where(eq(users.username, 'admin'));
    const a = await ctx.http().patch(`/api/v1/users/${admin!.id}`).set(bearer(adminToken)).send({ isActive: false });
    const b = await ctx.http().patch(`/api/v1/users/${admin!.id}`).set(bearer(adminToken)).send({ role: 'INVENTORY_STAFF' });
    expect(a.status).toBe(409);
    expect(b.status).toBe(409);
  });

  it('validates input with the uniform error envelope', async () => {
    const res = await ctx.http().post('/api/v1/users').set(bearer(adminToken)).send({ username: 'x', role: 'KING' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toBeInstanceOf(Array);
    expect((await ctx.http().get('/api/v1/users/not-a-uuid').set(bearer(adminToken))).status).toBe(400);
  });

  it('audits user changes inside the same transaction, without secrets', async () => {
    const logs = await ctx.http().get('/api/v1/audit-logs?entityType=user').set(bearer(adminToken));
    expect(logs.status).toBe(200);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['user.create', 'user.password.reset', 'user.update', 'user.password.change']));
    expect(JSON.stringify(logs.body)).not.toMatch(/argon2|Brand-New|temporaryPassword/);
  });

  it('audits repeated failed logins', async () => {
    for (let i = 0; i < 3; i++) await ctx.login('staff1', 'nope-nope');
    const rows = await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, 'auth.login.failed'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('credential slip', () => {
  const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('prints a one-time PDF slip after create/reset, and never again', async () => {
    const adminToken = (await ctx.login('admin', 'Brand-New-Pass-9')).body.accessToken;
    const created = await ctx.http().post('/api/v1/users').set(bearer(adminToken))
      .send({ username: 'slip.user', displayName: 'Slip User', role: 'STALL_MANAGER' });
    expect(created.body.slipToken).toEqual(expect.any(String));
    const url = `/api/v1/users/${created.body.user.id}/credential-slip.pdf`;

    expect((await ctx.http().get(url).set(bearer(adminToken))).status).toBe(400); // token required
    const other = await ctx.http().get(`/api/v1/users/${crypto.randomUUID()}/credential-slip.pdf`).query({ token: created.body.slipToken }).set(bearer(adminToken));
    expect(other.status).toBe(404); // token is bound to the user (and burns)

    const reset = await ctx.http().post(`/api/v1/users/${created.body.user.id}/reset-password`).set(bearer(adminToken));
    const ok = await ctx.http().get(url).query({ token: reset.body.slipToken }).set(bearer(adminToken)).buffer(true).parse(binary);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/application\/pdf/);
    expect((ok.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await ctx.http().get(url).query({ token: reset.body.slipToken }).set(bearer(adminToken))).status).toBe(404);

    const staff = await ctx.userToken('staff-slip', 'INVENTORY_STAFF');
    expect((await ctx.http().get(url).query({ token: 'x'.repeat(20) }).set(bearer(staff))).status).toBe(403);
  });
});
