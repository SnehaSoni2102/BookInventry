import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  auditLogs, copies, genres, saleItems, sales, settings, stallAssignments, stallMovements, stalls, users,
} from '../src/db/schema/index.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let admin: string;
let adminId: string;
let staff: string;
const g: Record<string, string> = {};
let n = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};
const ref = () => crypto.randomUUID();

interface Book { id: string; code: string }
async function addBooks(title: string, qty: number, over: { condition?: string; price?: number; genre?: string; titleId?: string } = {}) {
  const res = await ctx.http().post('/api/v1/copies').set(bearer(staff)).send({
    clientRef: ref(), quantity: qty,
    copy: { condition: over.condition ?? 'GOOD', sellingPriceMinor: over.price ?? 10000 },
    ...(over.titleId ? { titleId: over.titleId } : { title: { title, authors: ['A. Writer'], genreId: g[over.genre ?? 'FIC'] } }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { titleId: res.body.title.id as string, books: res.body.copies as Book[], res };
}
async function newStall(name: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({ name, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.stall as { id: string };
}
async function newManager(username: string) {
  await ctx.userToken(username, 'STALL_MANAGER');
  return (await ctx.t.db.select().from(users).where(eq(users.username, username)))[0]!;
}
const managerToken = async (username: string) => (await ctx.login(username, 'Test-Pass-123')).body.accessToken as string;
const activate = (id: string) => ctx.http().post(`/api/v1/stalls/${id}/activate`).set(bearer(admin));
const checkout = (token: string, stallId: string, body: object) =>
  ctx.http().post(`/api/v1/stalls/${stallId}/checkout`).set(bearer(token)).send({ clientRef: ref(), ...body });
const checkin = (token: string, body: object) => ctx.http().post('/api/v1/checkin').set(bearer(token)).send({ clientRef: ref(), ...body });
const row = async (id: string) => (await ctx.t.db.select().from(copies).where(eq(copies.id, id)))[0]!;

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  adminId = (await ctx.t.db.select().from(users).where(eq(users.username, 'admin')))[0]!.id;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  for (const r of await ctx.t.db.select().from(genres)) g[r.code] = r.id;
});
afterAll(async () => {
  await ctx.close();
});

describe('stall CRUD and managers', () => {
  it('creates a stall together with a new manager account whose credentials are shown once', async () => {
    const res = await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({
      name: 'Diwali Mela', location: 'Town Hall', startsOn: '2026-11-01', endsOn: '2026-11-03',
      manager: { username: 'Diwali.Mgr', displayName: 'Asha' },
    });
    expect(res.status).toBe(201);
    expect(res.body.stall).toMatchObject({
      name: 'Diwali Mela', status: 'PLANNED', startsOn: '2026-11-01', counts: { atStall: 0, sold: 0, revenueMinor: 0 },
      managers: [{ username: 'diwali.mgr', displayName: 'Asha', isActive: true }],
    });
    expect(res.body.manager.initialPassword).toMatch(/^[A-Za-z2-9]{10}$/);
    expect(res.body.manager.slipToken).toEqual(expect.any(String));
    // the manager can sign in with it
    expect((await ctx.login('diwali.mgr', res.body.manager.initialPassword)).body.user.role).toBe('STALL_MANAGER');
    const logs = await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.entityId, res.body.stall.id));
    expect(logs.map((l) => l.action).sort()).toEqual(['stall.create', 'stall.manager.assign']);
  });

  it('validates names, dates and permissions', async () => {
    expect((await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({ name: 'diwali MELA' })).status).toBe(409);
    expect((await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({ name: 'X', startsOn: '2026-05-02', endsOn: '2026-05-01' })).status).toBe(400);
    expect((await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({ name: '' })).status).toBe(400);
    expect((await ctx.http().post('/api/v1/stalls').set(bearer(staff)).send({ name: 'Nope' })).status).toBe(403);
    // creating with a taken username rolls the stall back too
    const dup = await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({ name: 'Rolled Back', manager: { username: 'staff1', displayName: 'x' } });
    expect(dup.status).toBe(409);
    expect((await ctx.t.db.select().from(stalls).where(eq(stalls.name, 'Rolled Back')))).toHaveLength(0);
  });

  it('lists stalls for staff (read-only) and by status', async () => {
    const all = await ctx.http().get('/api/v1/stalls').set(bearer(staff));
    expect(all.status).toBe(200);
    expect(all.body.map((s: { name: string }) => s.name)).toContain('Diwali Mela');
    expect((await ctx.http().get('/api/v1/stalls?status=ACTIVE').set(bearer(admin))).body).toEqual([]);
    expect((await ctx.http().get('/api/v1/stalls?status=NOPE').set(bearer(admin))).status).toBe(400);
  });

  it('activates a planned stall once', async () => {
    const s = await newStall('Activate Me');
    const ok = await activate(s.id);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'ACTIVE', activatedAt: expect.any(String) });
    expect((await activate(s.id)).status).toBe(409);
  });

  it('assigns managers: one active stall per manager unless explicitly moved; several managers per stall', async () => {
    const a = await newStall('Assign A');
    const b = await newStall('Assign B');
    const m1 = await newManager('assign.m1');
    const m2 = await newManager('assign.m2');
    const post = (stall: string, body: object) => ctx.http().post(`/api/v1/stalls/${stall}/managers`).set(bearer(admin)).send(body);

    expect((await post(a.id, { userId: m1.id })).body.managers).toHaveLength(1);
    expect((await post(a.id, { userId: m2.id })).body.managers).toHaveLength(2); // several managers on one stall
    expect((await post(a.id, { userId: m1.id })).status).toBe(409); // already here

    const elsewhere = await post(b.id, { userId: m1.id });
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.error.details).toMatchObject({ stallName: 'Assign A' });
    const moved = await post(b.id, { userId: m1.id, moveFromOtherStall: true });
    expect(moved.status).toBe(201);
    expect(moved.body.managers.map((m: { username: string }) => m.username)).toEqual(['assign.m1']);
    expect((await ctx.http().get(`/api/v1/stalls/${a.id}`).set(bearer(admin))).body.managers.map((m: { username: string }) => m.username)).toEqual(['assign.m2']);

    // only manager accounts, only active ones
    expect((await post(b.id, { userId: adminId })).status).toBe(400);
    const dead = await newManager('assign.dead');
    await ctx.t.db.update(users).set({ isActive: false }).where(eq(users.id, dead.id));
    expect((await post(b.id, { userId: dead.id })).status).toBe(400);
    expect((await post(b.id, { userId: crypto.randomUUID() })).status).toBe(404);

    const un = await ctx.http().delete(`/api/v1/stalls/${b.id}/managers/${m1.id}`).set(bearer(admin));
    expect(un.status).toBe(200);
    expect(un.body.managers).toEqual([]);
    expect((await ctx.http().delete(`/api/v1/stalls/${b.id}/managers/${m1.id}`).set(bearer(admin))).status).toBe(404);
    expect((await ctx.http().post(`/api/v1/stalls/${a.id}/managers`).set(bearer(staff)).send({ userId: m1.id })).status).toBe(403);
  });

  it('edits a stall, but a closed stall only has its notes editable', async () => {
    const s = await newStall('Editable');
    const up = await ctx.http().patch(`/api/v1/stalls/${s.id}`).set(bearer(admin)).send({ location: 'Park', endsOn: null });
    expect(up.body.location).toBe('Park');
    expect((await ctx.http().patch(`/api/v1/stalls/${s.id}`).set(bearer(admin)).send({ name: 'diwali mela' })).status).toBe(409);
    await ctx.http().post(`/api/v1/stalls/${s.id}/close`).set(bearer(admin)).send({ markRemainingAs: 'LOST' });
    expect((await ctx.http().patch(`/api/v1/stalls/${s.id}`).set(bearer(admin)).send({ name: 'Renamed' })).status).toBe(409);
    expect((await ctx.http().patch(`/api/v1/stalls/${s.id}`).set(bearer(admin)).send({ description: 'final notes' })).body.description).toBe('final notes');
  });
});

describe('checkout', () => {
  it('(A) sends explicit copies: partial success, keeps the slot reserved, one audit entry per batch', async () => {
    const stall = await newStall('Checkout A');
    const { books } = await addBooks('Checkout A Book', 4);
    const before = await Promise.all(books.map((b) => row(b.id)));
    await ctx.t.db.update(copies).set({ status: 'SOLD', soldAt: new Date(), rowId: null, slotNumber: null }).where(eq(copies.id, books[3]!.id)); // unavailable

    const unknown = crypto.randomUUID();
    const body = { copyIds: [books[2]!.id, books[0]!.id, books[1]!.id, books[3]!.id, unknown] };
    const res = await checkout(staff, stall.id, body);
    expect(res.status).toBe(201);
    expect(res.body.checkedOut.map((c: { code: string }) => c.code)).toEqual([books[0]!.code, books[1]!.code, books[2]!.code]); // shelf order
    expect(res.body.checkedOut[0]).toMatchObject({ locationCode: expect.stringMatching(/^FIC-A01-/), title: 'Checkout A Book' });
    expect(res.body.failed).toEqual([
      { copyId: books[3]!.id, code: books[3]!.code, reason: 'COPY_NOT_AVAILABLE' },
      { copyId: unknown, reason: 'NOT_FOUND' },
    ]);

    for (const [i, b] of books.slice(0, 3).entries()) {
      const after = await row(b.id);
      expect(after).toMatchObject({ status: 'AT_STALL', currentStallId: stall.id, rowId: before[i]!.rowId, slotNumber: before[i]!.slotNumber });
    }
    const moves = await ctx.t.db.select().from(stallMovements).where(eq(stallMovements.stallId, stall.id));
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.outcome === 'OPEN' && m.batchId === res.body.batchId && m.checkedOutById)).toBe(true);
    const audits = await ctx.t.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'stall.checkout'), eq(auditLogs.entityId, stall.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ count: 3, batchId: res.body.batchId });
  });

  it('is idempotent on clientRef', async () => {
    const stall = await newStall('Idempotent Checkout');
    const { books } = await addBooks('Idem Book', 2);
    const clientRef = ref();
    const one = await checkout(staff, stall.id, { clientRef, copyIds: [books[0]!.id] });
    const two = await checkout(staff, stall.id, { clientRef, copyIds: [books[0]!.id] });
    expect(two.status).toBe(201);
    expect(two.body).toEqual(one.body);
    expect(await ctx.t.db.select().from(stallMovements).where(eq(stallMovements.stallId, stall.id))).toHaveLength(1);
  });

  it('(B) picks N copies of a group in shelf order, all-or-nothing per group', async () => {
    const stall = await newStall('Checkout B');
    const first = await addBooks('Group Book', 3, { condition: 'GOOD', price: 10000 });
    await addBooks('Group Book', 2, { titleId: first.titleId, condition: 'FAIR', price: 5000 });
    const other = await addBooks('Other Group Book', 1, { condition: 'GOOD', price: 10000 });

    const res = await checkout(staff, stall.id, {
      groups: [
        { titleId: first.titleId, condition: 'GOOD', sellingPriceMinor: 10000, quantity: 2 },
        { titleId: first.titleId, condition: 'FAIR', sellingPriceMinor: 5000, quantity: 3 }, // only 2 exist
        { titleId: other.titleId, condition: 'GOOD', sellingPriceMinor: 10000, quantity: 1 },
        { titleId: other.titleId, condition: 'NEW', sellingPriceMinor: 10000, quantity: 1 }, // none
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.checkedOut).toHaveLength(3);
    // the two lowest slots of the GOOD group were taken, so the third stays on the shelf
    const goodCodes = first.books.map((b) => b.code);
    expect(res.body.checkedOut.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining([goodCodes[0], goodCodes[1], other.books[0]!.code]));
    expect(res.body.checkedOut.map((c: { code: string }) => c.code)).not.toContain(goodCodes[2]);
    expect(res.body.failed).toEqual([
      { group: { titleId: first.titleId, condition: 'FAIR', sellingPriceMinor: 5000, quantity: 3 }, reason: 'INSUFFICIENT_STOCK', available: 2 },
      { group: { titleId: other.titleId, condition: 'NEW', sellingPriceMinor: 10000, quantity: 1 }, reason: 'INSUFFICIENT_STOCK', available: 0 },
    ]);
    // the FAIR copies were not partially taken
    const fair = await ctx.t.db.select().from(copies).where(and(eq(copies.titleId, first.titleId), eq(copies.condition, 'FAIR')));
    expect(fair.every((c) => c.status === 'IN_STOCK')).toBe(true);
  });

  it('concurrent group checkouts never hand out the same copy twice', async () => {
    const s1 = await newStall('Race 1');
    const s2 = await newStall('Race 2');
    const { titleId } = await addBooks('Race Book', 4);
    const group = { titleId, condition: 'GOOD', sellingPriceMinor: 10000, quantity: 3 };
    const [r1, r2] = await Promise.all([checkout(staff, s1.id, { groups: [group] }), checkout(staff, s2.id, { groups: [group] })]);
    const sent = r1.body.checkedOut.length + r2.body.checkedOut.length;
    expect(sent).toBe(3); // exactly one wins; the other gets INSUFFICIENT_STOCK
    expect([r1.body.failed.length, r2.body.failed.length].sort()).toEqual([0, 1]);
    const open = await ctx.t.db.select().from(stallMovements).where(inArray(stallMovements.stallId, [s1.id, s2.id]));
    expect(new Set(open.map((m) => m.copyId)).size).toBe(open.length);
  });

  it('works for planned and active stalls, not closed or deleted ones; managers cannot check out', async () => {
    const closed = await newStall('Closed Target');
    await ctx.http().post(`/api/v1/stalls/${closed.id}/close`).set(bearer(admin)).send({ markRemainingAs: 'LOST' });
    const planned = await newStall('Planned Target');
    const { books } = await addBooks('Target Book', 3);
    const res = await checkout(staff, closed.id, { copyIds: [books[0]!.id] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALL_NOT_ACTIVE');
    expect((await checkout(staff, planned.id, { copyIds: [books[0]!.id] })).status).toBe(201);
    expect((await checkout(staff, crypto.randomUUID(), { copyIds: [books[1]!.id] })).status).toBe(404);

    const mgr = await newManager('co.mgr');
    await ctx.http().post(`/api/v1/stalls/${planned.id}/managers`).set(bearer(admin)).send({ userId: mgr.id });
    expect((await checkout(await managerToken('co.mgr'), planned.id, { copyIds: [books[1]!.id] })).status).toBe(403);
  });

  it('validates the body', async () => {
    const s = await newStall('Validation');
    expect((await checkout(staff, s.id, {})).status).toBe(400);
    expect((await checkout(staff, s.id, { copyIds: [ref()], groups: [] })).status).toBe(400);
    expect((await checkout(staff, s.id, { copyIds: ['x'] })).status).toBe(400);
    expect((await ctx.http().post(`/api/v1/stalls/${s.id}/checkout`).set(bearer(staff)).send({ copyIds: [ref()] })).status).toBe(400); // clientRef required
  });

  it('renders a pick list PDF sorted by shelf location', async () => {
    const stall = await newStall('Pick List');
    const { books } = await addBooks('Pick Book', 3);
    const res = await checkout(staff, stall.id, { copyIds: books.map((b) => b.id) });
    const pdf = await ctx.http().get(`/api/v1/stalls/${stall.id}/pick-list.pdf`).query({ batchId: res.body.batchId }).set(bearer(staff)).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await ctx.http().get(`/api/v1/stalls/${stall.id}/pick-list.pdf`).query({ batchId: ref() }).set(bearer(staff))).status).toBe(404);
    expect((await ctx.http().get(`/api/v1/stalls/${stall.id}/pick-list.pdf`).set(bearer(staff))).status).toBe(400);
    const mgr = await newManager('pick.mgr');
    await ctx.http().post(`/api/v1/stalls/${stall.id}/managers`).set(bearer(admin)).send({ userId: mgr.id });
    expect((await ctx.http().get(`/api/v1/stalls/${stall.id}/pick-list.pdf`).query({ batchId: res.body.batchId }).set(bearer(await managerToken('pick.mgr')))).status).toBe(403);
  });
});

describe('check-in', () => {
  it('returns each copy to exactly the slot it came from', async () => {
    const stall = await newStall('Checkin Stall');
    const { books } = await addBooks('Checkin Book', 3);
    const before = await Promise.all(books.map((b) => row(b.id)));
    const out = await checkout(staff, stall.id, { copyIds: books.map((b) => b.id) });

    // fill the shelf in the meantime: nobody else may take the reserved slots
    const filler = await addBooks('Filler', 5);
    const taken = new Set(before.map((b) => `${b.rowId}:${b.slotNumber}`));
    for (const f of filler.books) {
      const r = await row(f.id);
      expect(taken.has(`${r.rowId}:${r.slotNumber}`)).toBe(false);
    }

    const res = await checkin(staff, { codes: [books[1]!.code, books[0]!.code, books[2]!.code] });
    expect(res.status).toBe(201);
    expect(res.body.failed).toEqual([]);
    for (const item of res.body.checkedIn) {
      const idx = books.findIndex((b) => b.id === item.copyId);
      expect(item).toMatchObject({ fromStall: { id: stall.id, name: 'Checkin Stall' }, relocated: false });
      expect(item.returnToLocation).toBe(out.body.checkedOut.find((c: { copyId: string }) => c.copyId === item.copyId).locationCode);
      expect(await row(item.copyId)).toMatchObject({ status: 'IN_STOCK', currentStallId: null, rowId: before[idx]!.rowId, slotNumber: before[idx]!.slotNumber });
    }
    const moves = await ctx.t.db.select().from(stallMovements).where(eq(stallMovements.stallId, stall.id));
    expect(moves.every((m) => m.outcome === 'RETURNED' && m.checkedInAt && m.checkedInById)).toBe(true);
  });

  it('reports copies that are not at a stall or unknown, accepts ids or codes, and is idempotent', async () => {
    const stall = await newStall('Checkin Errors');
    const { books } = await addBooks('Error Book', 2);
    await checkout(staff, stall.id, { copyIds: [books[0]!.id] });
    const clientRef = ref();
    const res = await checkin(staff, { clientRef, copyIds: [books[0]!.id, books[1]!.id] });
    expect(res.body.checkedIn.map((c: { code: string }) => c.code)).toEqual([books[0]!.code]);
    expect(res.body.failed).toEqual([{ copyId: books[1]!.id, code: books[1]!.code, reason: 'NOT_AT_STALL' }]);
    const replay = await checkin(staff, { clientRef, copyIds: [books[0]!.id, books[1]!.id] });
    expect(replay.body).toEqual(res.body);
    expect((await checkin(staff, { codes: ['BK9999999'] })).body.failed).toEqual([{ code: 'BK9999999', reason: 'NOT_FOUND' }]);
    expect((await checkin(staff, { codes: ['nope'] })).status).toBe(400);
    expect((await checkin(staff, {})).status).toBe(400);
  });

  it('allocates a new slot and says so when the reserved one is gone', async () => {
    const stall = await newStall('Repair Stall');
    const { books } = await addBooks('Repair Book', 1);
    await checkout(staff, stall.id, { copyIds: [books[0]!.id] });
    await ctx.t.db.update(copies).set({ rowId: null, slotNumber: null }).where(eq(copies.id, books[0]!.id)); // simulate a data repair
    const res = await checkin(staff, { codes: [books[0]!.code] });
    expect(res.body.checkedIn[0]).toMatchObject({ relocated: true, returnToLocation: expect.stringMatching(/^FIC-A01-\d{3}$/) });
    expect(await row(books[0]!.id)).toMatchObject({ status: 'IN_STOCK', labelNeedsPrint: true });
    expect((await row(books[0]!.id)).rowId).not.toBeNull();
  });

  it('is limited to people with stall.checkin', async () => {
    const stall = await newStall('Checkin Perm');
    const { books } = await addBooks('Perm Book', 1);
    await checkout(staff, stall.id, { copyIds: [books[0]!.id] });
    const mgr = await newManager('ci.mgr');
    await ctx.http().post(`/api/v1/stalls/${stall.id}/managers`).set(bearer(admin)).send({ userId: mgr.id });
    expect((await checkin(await managerToken('ci.mgr'), { codes: [books[0]!.code] })).status).toBe(403);
    expect((await ctx.http().post('/api/v1/checkin').send({ clientRef: ref(), codes: [books[0]!.code] })).status).toBe(401);
  });
});

describe('manager scoping', () => {
  it('lets a manager see only their own stall', async () => {
    const mine = await newStall('Scoped Mine');
    const theirs = await newStall('Scoped Theirs');
    const m = await newManager('scoped.mgr');
    await ctx.http().post(`/api/v1/stalls/${mine.id}/managers`).set(bearer(admin)).send({ userId: m.id });
    const tok = await managerToken('scoped.mgr');
    const { books } = await addBooks('Scoped Book', 2);
    await checkout(staff, mine.id, { copyIds: [books[0]!.id] });
    await checkout(staff, theirs.id, { copyIds: [books[1]!.id] });

    expect((await ctx.http().get('/api/v1/stalls/mine').set(bearer(tok))).body.stall).toMatchObject({ id: mine.id, counts: { atStall: 1 } });
    expect((await ctx.http().get(`/api/v1/stalls/${mine.id}`).set(bearer(tok))).status).toBe(200);
    expect((await ctx.http().get(`/api/v1/stalls/${theirs.id}`).set(bearer(tok))).status).toBe(404);
    expect((await ctx.http().get('/api/v1/stalls').set(bearer(tok))).status).toBe(403);
    expect((await ctx.http().patch(`/api/v1/stalls/${mine.id}`).set(bearer(tok)).send({ name: 'x' })).status).toBe(403);
    expect((await ctx.http().get(`/api/v1/stalls/${mine.id}/reconciliation`).set(bearer(tok))).status).toBe(403);

    const inv = await ctx.http().get(`/api/v1/stalls/${mine.id}/inventory`).set(bearer(tok));
    expect(inv.body.items.map((i: { title: string; availableCount: number }) => [i.title, i.availableCount])).toEqual([['Scoped Book', 1]]);
    expect((await ctx.http().get(`/api/v1/stalls/${theirs.id}/inventory`).set(bearer(tok))).status).toBe(404);
    // staff/admin can look at any stall's inventory
    expect((await ctx.http().get(`/api/v1/stalls/${theirs.id}/inventory`).set(bearer(staff))).body.items[0].availableCount).toBe(1);
    expect((await ctx.http().get('/api/v1/stalls/mine').set(bearer(await ctx.userToken('mgr.free', 'STALL_MANAGER')))).body).toEqual({ stall: null });
  });
});

describe('deleting stalls', () => {
  it('is blocked while books are out, then soft-deletes and frees the name', async () => {
    const s = await newStall('Doomed');
    const mgr = await newManager('doomed.mgr');
    await ctx.http().post(`/api/v1/stalls/${s.id}/managers`).set(bearer(admin)).send({ userId: mgr.id });
    const { books } = await addBooks('Doomed Book', 1);
    await checkout(staff, s.id, { copyIds: [books[0]!.id] });

    const blocked = await ctx.http().delete(`/api/v1/stalls/${s.id}`).set(bearer(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'STALL_HAS_OPEN_CHECKOUTS', details: { count: 1, codes: [books[0]!.code] } });

    await checkin(staff, { codes: [books[0]!.code] });
    expect((await ctx.http().delete(`/api/v1/stalls/${s.id}`).set(bearer(admin))).status).toBe(204);
    expect((await ctx.http().get(`/api/v1/stalls/${s.id}`).set(bearer(admin))).status).toBe(404);
    expect((await ctx.http().get('/api/v1/stalls').set(bearer(admin))).body.map((x: { id: string }) => x.id)).not.toContain(s.id);
    // row is kept, managers released, and the name can be reused
    const [kept] = await ctx.t.db.select().from(stalls).where(eq(stalls.id, s.id));
    expect(kept!.deletedAt).toBeInstanceOf(Date);
    expect((await ctx.t.db.select().from(stallAssignments).where(and(eq(stallAssignments.stallId, s.id)))).every((a) => a.unassignedAt)).toBe(true);
    expect((await ctx.http().post('/api/v1/stalls').set(bearer(admin)).send({ name: 'doomed' })).status).toBe(201);
    expect((await ctx.http().delete(`/api/v1/stalls/${s.id}`).set(bearer(admin))).status).toBe(404);
    expect((await ctx.http().delete(`/api/v1/stalls/${crypto.randomUUID()}`).set(bearer(staff))).status).toBe(403);
  });

  it('keeps a deleted stall that has sales in reports as "(deleted) name"', async () => {
    const s = await newStall('Sold Out Fest');
    const { books } = await addBooks('Fest Book', 1, { price: 25000 });
    await checkout(staff, s.id, { copyIds: [books[0]!.id] });
    await sellAtStall(s.id, books[0]!.id, 25000, 'UPI');
    expect((await ctx.http().delete(`/api/v1/stalls/${s.id}`).set(bearer(admin))).status).toBe(204);
    const rec = await ctx.http().get(`/api/v1/stalls/${s.id}/reconciliation`).set(bearer(admin));
    expect(rec.status).toBe(200);
    expect(rec.body.stall.name).toBe('(deleted) Sold Out Fest');
    expect(rec.body).toMatchObject({ sold: 1, revenueMinor: 25000 });
  });
});

/** Sales endpoints arrive in M8; until then write the rows a sale would leave behind. */
let receipt = 0;
async function sellAtStall(stallId: string, copyId: string, price: number, method: 'CASH' | 'UPI' | 'CARD' | 'OTHER') {
  const [sale] = await ctx.t.db.insert(sales).values({
    receiptNo: `R-T${String(++receipt).padStart(5, '0')}`, stallId, soldById: adminId, paymentMethod: method, totalMinor: price,
  }).returning();
  await ctx.t.db.insert(saleItems).values({ saleId: sale!.id, copyId, listPriceMinor: price, soldPriceMinor: price });
  await ctx.t.db.update(copies).set({ status: 'SOLD', soldAt: new Date(), rowId: null, slotNumber: null, currentStallId: null }).where(eq(copies.id, copyId));
  await ctx.t.db.update(stallMovements).set({ outcome: 'SOLD' }).where(and(eq(stallMovements.copyId, copyId), eq(stallMovements.outcome, 'OPEN')));
}

describe('reconciliation, close and reports', () => {
  async function setupStall(name: string) {
    const stall = await newStall(name);
    await activate(stall.id);
    const mgr = await newManager(`${name.toLowerCase().replace(/\W/g, '')}.mgr`);
    await ctx.http().post(`/api/v1/stalls/${stall.id}/managers`).set(bearer(admin)).send({ userId: mgr.id });
    const { books } = await addBooks(`${name} Book`, 5, { price: 10000 });
    await checkout(staff, stall.id, { copyIds: books.map((b) => b.id) });
    await sellAtStall(stall.id, books[0]!.id, 10000, 'CASH');
    await sellAtStall(stall.id, books[1]!.id, 10000, 'UPI');
    await checkin(staff, { codes: [books[2]!.code] });
    return { stall, mgr, books };
  }

  it('summarises sent / sold / returned / still out and revenue by payment method', async () => {
    const { stall, books } = await setupStall('Recon One');
    const rec = await ctx.http().get(`/api/v1/stalls/${stall.id}/reconciliation`).set(bearer(admin));
    expect(rec.status).toBe(200);
    expect(rec.body).toMatchObject({
      sent: 5, sold: 2, returned: 1, lost: 0, revenueMinor: 20000, salesCount: 2,
      byPaymentMethod: { CASH: 10000, UPI: 10000, CARD: 0, OTHER: 0 }, stall: { status: 'ACTIVE' },
    });
    expect(rec.body.stillOut.map((b: { code: string }) => b.code).sort()).toEqual([books[3]!.code, books[4]!.code].sort());
    expect(rec.body.stillOut[0]).toMatchObject({ title: 'Recon One Book', locationCode: expect.stringMatching(/^FIC-/), sellingPriceMinor: 10000 });

    const hist = await ctx.http().get(`/api/v1/stalls/${stall.id}/movements?outcome=SOLD`).set(bearer(admin));
    expect(hist.body.total).toBe(2);
    expect(hist.body.items[0]).toMatchObject({ outcome: 'SOLD', checkedOutBy: 'staff1', copy: { title: 'Recon One Book' } });
    expect((await ctx.http().get(`/api/v1/stalls/${stall.id}/movements`).set(bearer(admin))).body.total).toBe(5);
  });

  it('close(LOST) writes off what is still out, frees the slots, ends assignments and deactivates managers', async () => {
    const { stall, mgr, books } = await setupStall('Close Lost');
    const mgrToken = await managerToken('closelost.mgr');
    const slots = await Promise.all([books[3]!, books[4]!].map((b) => row(b.id)));

    const res = await ctx.http().post(`/api/v1/stalls/${stall.id}/close`).set(bearer(admin)).send({ markRemainingAs: 'LOST' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 5, sold: 2, returned: 1, lost: 2, stillOut: [], stall: { status: 'CLOSED' } });

    for (const [i, b] of [books[3]!, books[4]!].entries()) {
      expect(await row(b.id)).toMatchObject({ status: 'WRITTEN_OFF', writeoffReason: 'LOST', rowId: null, slotNumber: null, currentStallId: null, lastLocationCode: expect.stringMatching(/^FIC-/) });
      void slots[i];
    }
    const [closed] = await ctx.t.db.select().from(stalls).where(eq(stalls.id, stall.id));
    expect(closed).toMatchObject({ status: 'CLOSED', closedAt: expect.any(Date) });
    expect((await ctx.t.db.select().from(stallAssignments).where(eq(stallAssignments.stallId, stall.id))).every((a) => a.unassignedAt)).toBe(true);

    // manager account is deactivated and the live session is dead
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(mgrToken))).status).toBe(401);
    expect((await ctx.login('closelost.mgr', 'Test-Pass-123')).status).toBe(401);
    expect((await ctx.t.db.select().from(users).where(eq(users.id, mgr.id)))[0]!.isActive).toBe(false);

    expect((await ctx.http().post(`/api/v1/stalls/${stall.id}/close`).set(bearer(admin)).send({ markRemainingAs: 'LOST' })).status).toBe(409);
    // freed slots can be reused by new books
    const again = await addBooks('After Close', 2);
    expect(await Promise.all(again.books.map(async (b) => (await row(b.id)).rowId))).not.toContain(null);
  });

  it('close(KEEP_OPEN) leaves books out so they can still be checked in later; the deactivation setting is honoured', async () => {
    await ctx.t.db.update(settings).set({ value: false }).where(eq(settings.key, 'stall.deactivateManagersOnClose'));
    const { stall, mgr, books } = await setupStall('Close Keep');
    const res = await ctx.http().post(`/api/v1/stalls/${stall.id}/close`).set(bearer(admin)).send({ markRemainingAs: 'KEEP_OPEN' });
    expect(res.body).toMatchObject({ lost: 0, stillOut: [{ code: expect.any(String) }, { code: expect.any(String) }], stall: { status: 'CLOSED' } });
    expect((await ctx.t.db.select().from(users).where(eq(users.id, mgr.id)))[0]!.isActive).toBe(true);
    expect((await row(books[3]!.id)).status).toBe('AT_STALL');
    const late = await checkin(staff, { codes: [books[3]!.code, books[4]!.code] });
    expect(late.body.checkedIn).toHaveLength(2);
    expect((await ctx.http().get(`/api/v1/stalls/${stall.id}/reconciliation`).set(bearer(admin))).body).toMatchObject({ returned: 3, stillOut: [] });
    await ctx.t.db.update(settings).set({ value: true }).where(eq(settings.key, 'stall.deactivateManagersOnClose'));
  });

  it('produces PDF and XLSX stall reports', async () => {
    const { stall } = await setupStall('Report Stall');
    const pdf = await ctx.http().get(`/api/v1/stalls/${stall.id}/report.pdf`).set(bearer(admin)).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const x = await ctx.http().get(`/api/v1/stalls/${stall.id}/report.xlsx`).set(bearer(admin)).buffer(true).parse(binary);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Books sent', 'Still out']);
    expect(wb.getWorksheet('Books sent')!.rowCount).toBe(6); // header + 5 books
    expect(wb.getWorksheet('Summary')!.getRow(9).getCell(2).value).toBe(200); // revenue ₹200
    expect((await ctx.http().get(`/api/v1/stalls/${stall.id}/report.pdf`).set(bearer(staff))).status).toBe(403);
  });
});
