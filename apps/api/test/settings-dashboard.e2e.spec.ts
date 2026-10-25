import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, copies, genres, stallAssignments, stalls, users } from '../src/db/schema/index.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let admin: string;
let staff: string;
const g: Record<string, string> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};
const ref = () => crypto.randomUUID();

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  for (const r of await ctx.t.db.select().from(genres)) g[r.code] = r.id;
});
afterAll(async () => {
  await ctx.close();
});

describe('settings', () => {
  it('gives admins every setting and everyone else only the client-safe subset', async () => {
    const all = await ctx.http().get('/api/v1/settings').set(bearer(admin));
    expect(all.body.settings).toMatchObject({ 'org.name': 'Goonj', 'pricing.roundToMinor': 1000, 'sales.managerSeesWholeStall': false });
    const client = await ctx.http().get('/api/v1/settings').set(bearer(staff));
    expect(client.body).toEqual({ client: expect.objectContaining({ orgName: 'Goonj', currency: 'INR', codePrefix: 'BK' }) });
    expect(JSON.stringify(client.body)).not.toMatch(/managerSeesWholeStall|pricing/);
  });

  it('validates each key and rejects unknown ones', async () => {
    const patch = (b: object) => ctx.http().patch('/api/v1/settings').set(bearer(admin)).send(b);
    for (const bad of [
      { 'org.name': '' }, { 'org.timezone': 'Mars/Olympus' }, { 'copy.codePrefix': 'b' }, { 'pricing.roundToMinor': 0 },
      { 'pricing.conditionPercent': { NEW: 60 } }, { 'public.fields': ['cover', 'donor'] }, { 'label.defaultTemplate': 'HUGE' },
      { 'shelf.lowSpaceThresholdPercent': 101 }, { 'nonsense.key': 1 }, {}, { 'sales.managerSeesWholeStall': 'yes' },
    ]) {
      const res = await patch(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await ctx.http().patch('/api/v1/settings').set(bearer(staff)).send({ 'org.name': 'X' })).status).toBe(403);
  });

  it('updates settings atomically, audits the change, and takes effect immediately', async () => {
    const res = await ctx.http().patch('/api/v1/settings').set(bearer(admin)).send({
      'org.name': 'Asha Foundation', 'pricing.conditionPercent': { NEW: 70, LIKE_NEW: 55, VERY_GOOD: 45, GOOD: 40, FAIR: 30, POOR: 20 }, 'pricing.roundToMinor': 500,
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ 'org.name': 'Asha Foundation', 'pricing.roundToMinor': 500, 'org.currency': 'INR' });
    const tip = await ctx.http().get('/api/v1/catalog/price-suggestion?originalPriceMinor=39900&condition=GOOD').set(bearer(admin));
    expect(tip.body).toEqual({ suggestedMinor: 16000, percent: 40, roundedToMinor: 500 }); // 159.6 → ₹160
    const [log] = await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, 'settings.update'));
    expect(log).toMatchObject({ before: { 'org.name': 'Goonj' }, after: { 'org.name': 'Asha Foundation' } });
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(staff))).body.settings.orgName).toBe('Asha Foundation');
  });
});

describe('dashboard', () => {
  it('shows only what each role may see', async () => {
    const stall = (await ctx.t.db.insert(stalls).values({ name: 'Dash Stall', status: 'ACTIVE' }).returning())[0]!;
    const mgrToken = await ctx.userToken('dash.mgr', 'STALL_MANAGER');
    const mgr = (await ctx.t.db.select().from(users).where(eq(users.username, 'dash.mgr')))[0]!;
    await ctx.t.db.insert(stallAssignments).values({ stallId: stall.id, userId: mgr.id });

    const made = await ctx.http().post('/api/v1/copies').set(bearer(staff)).send({
      clientRef: ref(), quantity: 4, copy: { condition: 'GOOD', sellingPriceMinor: 5000 }, title: { title: 'Dash Book', genreId: g.FIC },
    });
    const ids = made.body.copies.map((c: { id: string }) => c.id);
    await ctx.http().post(`/api/v1/stalls/${stall.id}/checkout`).set(bearer(staff)).send({ clientRef: ref(), copyIds: ids.slice(0, 2) });
    await ctx.http().post('/api/v1/sales').set(bearer(mgrToken)).send({ clientRef: ref(), paymentMethod: 'UPI', items: [{ copyId: ids[0] }] });
    await ctx.t.db.update(copies).set({ rowId: null, slotNumber: null }).where(eq(copies.id, ids[3])); // one unshelved

    const a = (await ctx.http().get('/api/v1/dashboard').set(bearer(admin))).body;
    expect(a.inventory).toEqual({ titles: 1, inStock: 2, atStalls: 1, unshelved: 1, labelsPending: 3, writtenOff: 0 });
    expect(a.salesToday.total).toMatchObject({ salesCount: 1, itemsCount: 1, revenueMinor: 5000 });
    expect(a.salesToday.rows.find((r: { label: string }) => r.label === 'Dash Stall')).toMatchObject({ revenueMinor: 5000, byPaymentMethod: { UPI: 5000 } });
    expect(a.activeStalls).toHaveLength(1);
    expect(a.recentSales).toHaveLength(1);
    expect(a.shelfAlerts).toEqual([]);
    expect(a.myStall).toBeUndefined();

    const s = (await ctx.http().get('/api/v1/dashboard').set(bearer(staff))).body;
    expect(s.inventory.unshelved).toBe(1);
    expect(s.salesToday).toBeUndefined();
    expect(s.recentSales).toBeUndefined();
    expect(s.activeStalls).toHaveLength(1); // needed to pick a stall for checkout/check-in

    const m = (await ctx.http().get('/api/v1/dashboard').set(bearer(mgrToken))).body;
    expect(m).toEqual({
      myStall: { stall: { id: stall.id, name: 'Dash Stall', status: 'ACTIVE' }, booksAtStall: 1, valueAtStallMinor: 5000, today: { salesCount: 1, itemsCount: 1, revenueMinor: 5000 } },
    });
    expect((await ctx.http().get('/api/v1/dashboard')).status).toBe(401);
  });
});

describe('inventory export', () => {
  it('exports stock for people with report.read only', async () => {
    const res = await ctx.http().get('/api/v1/reports/inventory.xlsx').set(bearer(admin)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const ws = wb.getWorksheet('Inventory')!;
    expect(ws.rowCount).toBe(1 + 3); // header + 3 copies still in stock / at a stall (one sold)
    expect((ws.getRow(2).values as unknown[]).includes('Dash Book')).toBe(true);
    expect((await ctx.http().get('/api/v1/reports/inventory.xlsx').set(bearer(staff))).status).toBe(403);
  });
});
