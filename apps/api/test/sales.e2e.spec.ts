import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { auditLogs, copies, genres, sales, saleItems, settings, stallAssignments, stallMovements, stalls, users } from '../src/db/schema/index.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let admin: string;
let staff: string;
const g: Record<string, string> = {};
let url: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};
const ref = () => crypto.randomUUID();
const row = async (id: string) => (await ctx.t.db.select().from(copies).where(eq(copies.id, id)))[0]!;

interface Book { id: string; code: string; locationCode: string | null }
async function addBooks(title: string, qty: number, over: { price?: number; genre?: string; condition?: string } = {}) {
  const res = await ctx.http().post('/api/v1/copies').set(bearer(staff)).send({
    clientRef: ref(), quantity: qty,
    copy: { condition: over.condition ?? 'GOOD', sellingPriceMinor: over.price ?? 10000 },
    title: { title, authors: ['Some Writer'], genreId: g[over.genre ?? 'FIC'] },
  });
  expect(res.status).toBe(201);
  return res.body.copies as Book[];
}
const sell = (token: string, body: object) => ctx.http().post('/api/v1/sales').set(bearer(token)).send({ clientRef: ref(), paymentMethod: 'CASH', ...body });
const items = (...books: Book[]) => ({ items: books.map((b) => ({ copyId: b.id })) });

async function newStall(name: string, status: 'ACTIVE' | 'PLANNED' = 'ACTIVE') {
  const [s] = await ctx.t.db.insert(stalls).values({ name, status, ...(status === 'ACTIVE' ? { activatedAt: new Date() } : {}) }).returning();
  return s!.id;
}
async function newManager(username: string, stallId?: string) {
  const token = await ctx.userToken(username, 'STALL_MANAGER');
  const [u] = await ctx.t.db.select().from(users).where(eq(users.username, username));
  if (stallId) await ctx.t.db.insert(stallAssignments).values({ stallId, userId: u!.id });
  return { token, id: u!.id };
}
async function sendToStall(stallId: string, books: Book[]) {
  const res = await ctx.http().post(`/api/v1/stalls/${stallId}/checkout`).set(bearer(staff)).send({ clientRef: ref(), copyIds: books.map((b) => b.id) });
  expect(res.body.checkedOut).toHaveLength(books.length);
}

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  for (const r of await ctx.t.db.select().from(genres)) g[r.code] = r.id;
  url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await ctx.close();
});

describe('POST /sales — central sale by the admin', () => {
  it('records the sale, the receipt, and releases the shelf slots', async () => {
    const books = await addBooks('Central Book', 2, { price: 15000 });
    const before = await Promise.all(books.map((b) => row(b.id)));
    const res = await sell(admin, { ...items(books[0]!, books[1]!), paymentMethod: 'UPI', customerName: 'Ravi', notes: 'gift wrap' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      receiptNo: expect.stringMatching(/^R-\d{6}$/), stallId: null, soldAtLabel: 'Admin', totalMinor: 30000, itemsCount: 2,
      paymentMethod: 'UPI', status: 'COMPLETED', customerName: 'Ravi', seller: { displayName: 'Administrator' },
    });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ title: 'Central Book', listPriceMinor: 15000, soldPriceMinor: 15000, condition: 'GOOD' });
    for (const [i, b] of books.entries()) {
      expect(await row(b.id)).toMatchObject({ status: 'SOLD', rowId: null, slotNumber: null, currentStallId: null, soldAt: expect.any(Date), lastLocationCode: b.locationCode });
      expect(before[i]!.rowId).not.toBeNull();
    }
    const [log] = await ctx.t.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'sale.create'), eq(auditLogs.entityId, res.body.id)));
    expect(log!.after).toMatchObject({ receiptNo: res.body.receiptNo, totalMinor: 30000 });
    // the freed slot is handed to the next book
    const next = await addBooks('After Sale', 1);
    expect(next[0]!.locationCode).toBe(books[0]!.locationCode);
  });

  it('numbers receipts sequentially', async () => {
    const b = await addBooks('Receipt Seq', 2);
    const one = await sell(admin, items(b[0]!));
    const two = await sell(admin, items(b[1]!));
    expect(Number(two.body.receiptNo.slice(2))).toBe(Number(one.body.receiptNo.slice(2)) + 1);
  });

  it('exactly one of 10 parallel sales of the same copy succeeds', async () => {
    const [book] = await addBooks('Contested', 1);
    const results = await Promise.all(Array.from({ length: 10 }, () => sell(admin, items(book!))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const lost = results.filter((r) => r.status === 409);
    expect(lost).toHaveLength(9);
    expect(lost[0]!.body.error).toMatchObject({ code: 'COPY_NOT_AVAILABLE', details: { codes: [book!.code] } });
    expect(await ctx.t.db.select().from(saleItems).where(eq(saleItems.copyId, book!.id))).toHaveLength(1);
  });

  it('replays the original sale for the same clientRef, even when requests race', async () => {
    const [book] = await addBooks('Idempotent', 1);
    const clientRef = ref();
    const results = await Promise.all(Array.from({ length: 5 }, () => sell(admin, { ...items(book!), clientRef })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await ctx.t.db.select().from(sales).where(eq(sales.clientRef, clientRef))).toHaveLength(1);
    const again = await sell(admin, { ...items(book!), clientRef });
    expect(again.body.id).toBe(results[0]!.body.id);
    // someone else cannot read a sale by reusing its clientRef
    const other = await ctx.userToken('other.seller', 'STALL_MANAGER');
    const stealing = await sell(other, { ...items(book!), clientRef });
    expect(stealing.status).toBe(409);
  });

  it('rejects unavailable, unknown and duplicate copies and bad bodies', async () => {
    const [book] = await addBooks('Odd Cases', 1);
    await sell(admin, items(book!));
    const sold = await sell(admin, items(book!));
    expect(sold.body.error.code).toBe('COPY_NOT_AVAILABLE');
    expect((await sell(admin, { items: [{ copyId: ref() }] })).status).toBe(404);
    const [b2] = await addBooks('Dup', 1);
    expect((await sell(admin, { items: [{ copyId: b2!.id }, { copyId: b2!.id }] })).status).toBe(400);
    expect((await sell(admin, { items: [] })).status).toBe(400);
    expect((await sell(admin, { ...items(b2!), paymentMethod: 'BITCOIN' })).status).toBe(400);
    expect((await sell(admin, { ...items(b2!), clientRef: 'x' })).status).toBe(400);
    expect((await ctx.http().post('/api/v1/sales').send({ clientRef: ref(), paymentMethod: 'CASH', ...items(b2!) })).status).toBe(401);
    expect((await sell(staff, items(b2!))).status).toBe(403); // inventory staff cannot sell
    expect((await row(b2!.id)).status).toBe('IN_STOCK');
  });

  it('rolls back everything when one item fails (no half-sold cart)', async () => {
    const books = await addBooks('Cart', 2);
    await sell(admin, items(books[1]!));
    const res = await sell(admin, items(books[0]!, books[1]!));
    expect(res.status).toBe(409);
    expect((await row(books[0]!.id)).status).toBe('IN_STOCK');
  });
});

describe('POST /sales — pricing (D7)', () => {
  it('stall managers always sell at the listed price', async () => {
    const stallId = await newStall('Price Stall');
    const m = await newManager('price.mgr', stallId);
    const [book] = await addBooks('Priced', 1, { price: 20000 });
    await sendToStall(stallId, [book!]);

    const discount = await sell(m.token, { items: [{ copyId: book!.id, soldPriceMinor: 15000 }] });
    expect(discount.status).toBe(403);
    expect(discount.body.error).toMatchObject({ code: 'DISCOUNT_NOT_ALLOWED', details: { listPriceMinor: 20000 } });
    expect((await row(book!.id)).status).toBe('AT_STALL');

    const ok = await sell(m.token, { items: [{ copyId: book!.id, soldPriceMinor: 20000 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.totalMinor).toBe(20000);
  });

  it('an admin may override the price, and it is audited', async () => {
    const [a, b, c] = await addBooks('Overridden', 3, { price: 20000 });
    const res = await sell(admin, { items: [{ copyId: a!.id, soldPriceMinor: 12500 }, { copyId: b!.id }, { copyId: c!.id, soldPriceMinor: 0 }] });
    expect(res.status).toBe(201);
    expect(res.body.totalMinor).toBe(12500 + 20000 + 0);
    expect(res.body.items.map((i: { listPriceMinor: number; soldPriceMinor: number }) => [i.listPriceMinor, i.soldPriceMinor])).toEqual(expect.arrayContaining([[20000, 12500], [20000, 20000], [20000, 0]]));
    const logs = await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, 'sale.price.override'));
    const mine = logs.filter((l) => [a!.id, c!.id].includes(l.entityId));
    expect(mine).toHaveLength(2);
    expect(mine.find((l) => l.entityId === a!.id)).toMatchObject({ before: { sellingPriceMinor: 20000 }, after: { soldPriceMinor: 12500 } });
    expect(logs.find((l) => l.entityId === b!.id)).toBeUndefined();
  });

  it('refuses negative prices', async () => {
    const [a] = await addBooks('Negative', 1);
    expect((await sell(admin, { items: [{ copyId: a!.id, soldPriceMinor: -1 }] })).status).toBe(400);
  });
});

describe('POST /sales — stall managers (scoping)', () => {
  it('sells books at their own active stall and the sale is labelled with the stall', async () => {
    const stallId = await newStall('Mela One');
    const m = await newManager('mela.mgr', stallId);
    const books = await addBooks('Mela Book', 2, { price: 8000 });
    await sendToStall(stallId, books);

    const res = await sell(m.token, { ...items(books[0]!, books[1]!), paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stallId, soldAtLabel: 'Mela One', totalMinor: 16000, seller: { id: m.id } });
    expect((await row(books[0]!.id))).toMatchObject({ status: 'SOLD', currentStallId: null, rowId: null });
    const moves = await ctx.t.db.select().from(stallMovements).where(inArray(stallMovements.copyId, books.map((b) => b.id)));
    expect(moves.every((mv) => mv.outcome === 'SOLD')).toBe(true);
  });

  it("refuses books that are not at the manager's stall", async () => {
    const mine = await newStall('Mine');
    const theirs = await newStall('Theirs');
    const m = await newManager('scope.mgr', mine);
    const [central, other] = await addBooks('Elsewhere', 2);
    await sendToStall(theirs, [other!]);
    for (const book of [central!, other!]) {
      const res = await sell(m.token, items(book));
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'COPY_NOT_AT_YOUR_STALL', details: { codes: [book.code] } });
    }
    expect((await row(central!.id)).status).toBe('IN_STOCK');
    expect((await row(other!.id)).status).toBe('AT_STALL');
  });

  it('needs an ACTIVE stall', async () => {
    const planned = await newStall('Not Yet', 'PLANNED');
    const m = await newManager('planned.mgr', planned);
    const [book] = await addBooks('Early', 1);
    await sendToStall(planned, [book!]);
    expect((await sell(m.token, items(book!))).body.error.code).toBe('STALL_NOT_ACTIVE');
    await ctx.t.db.update(stalls).set({ status: 'ACTIVE' }).where(eq(stalls.id, planned));
    expect((await sell(m.token, items(book!))).status).toBe(201);

    const homeless = await ctx.userToken('homeless.mgr', 'STALL_MANAGER');
    const [b2] = await addBooks('No Stall', 1);
    expect((await sell(homeless, items(b2!))).body.error.code).toBe('STALL_NOT_ACTIVE');
  });
});

describe('POST /sales — admin selling a copy that is at a stall (D8)', () => {
  it('requires confirmation, then records "Admin @ stall"', async () => {
    const stallId = await newStall('Admin At Stall');
    const [book, book2] = await addBooks('At Stall', 2, { price: 5000 });
    await sendToStall(stallId, [book!, book2!]);

    const unconfirmed = await sell(admin, items(book!));
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.details).toMatchObject({ requiresConfirm: 'COPY_AT_STALL', stall: { id: stallId, name: 'Admin At Stall' } });
    expect((await row(book!.id)).status).toBe('AT_STALL');

    const ok = await sell(admin, { ...items(book!), confirmAtStallCopies: true });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ stallId, soldAtLabel: 'Admin @ Admin At Stall', seller: { displayName: 'Administrator' } });
    expect((await ctx.t.db.select().from(stallMovements).where(eq(stallMovements.copyId, book!.id)))[0]!.outcome).toBe('SOLD');

    // the stall's own counters include it
    const stall = await ctx.http().get(`/api/v1/stalls/${stallId}`).set(bearer(admin));
    expect(stall.body.counts).toMatchObject({ atStall: 1, sold: 1, revenueMinor: 5000 });
  });

  it('refuses a sale that mixes central stock and stall stock', async () => {
    const stallId = await newStall('Mixed');
    const [a, b] = await addBooks('Mixed Origin', 2);
    await sendToStall(stallId, [a!]);
    const res = await sell(admin, { ...items(a!, b!), confirmAtStallCopies: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('reading sales (D6 scoping)', () => {
  let stallA: string;
  let mgr1: { token: string; id: string };
  let mgr2: { token: string; id: string };
  let s1: { id: string; receiptNo: string };
  let s2: { id: string; receiptNo: string };
  let central: { id: string; receiptNo: string };
  let codes: string[];

  beforeAll(async () => {
    stallA = await newStall('Read Stall');
    mgr1 = await newManager('read.m1', stallA);
    mgr2 = await newManager('read.m2', stallA);
    const books = await addBooks('Readable Book', 4, { price: 7000 });
    codes = books.map((b) => b.code);
    await sendToStall(stallA, books.slice(0, 3));
    s1 = (await sell(mgr1.token, { ...items(books[0]!), paymentMethod: 'CASH' })).body;
    s2 = (await sell(mgr2.token, { ...items(books[1]!), paymentMethod: 'UPI' })).body;
    central = (await sell(admin, { ...items(books[3]!), paymentMethod: 'CARD' })).body;
  });

  it('admin sees everything, newest first, with labels', async () => {
    const res = await ctx.http().get('/api/v1/sales?pageSize=100').set(bearer(admin));
    expect(res.status).toBe(200);
    const mine = res.body.items.filter((i: { id: string }) => [s1.id, s2.id, central.id].includes(i.id));
    expect(mine.map((i: { id: string }) => i.id)).toEqual([central.id, s2.id, s1.id]);
    expect(mine.map((i: { soldAtLabel: string }) => i.soldAtLabel)).toEqual(['Admin', 'Read Stall', 'Read Stall']);
  });

  it('a manager sees only the sales they made', async () => {
    const res = await ctx.http().get('/api/v1/sales').set(bearer(mgr1.token));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([s1.id]);
    expect((await ctx.http().get(`/api/v1/sales/${s1.id}`).set(bearer(mgr1.token))).status).toBe(200);
    expect((await ctx.http().get(`/api/v1/sales/${s2.id}`).set(bearer(mgr1.token))).status).toBe(404); // co-manager's sale
    expect((await ctx.http().get(`/api/v1/sales/${central.id}`).set(bearer(mgr1.token))).status).toBe(404);
    // trying to widen the filter does nothing
    expect((await ctx.http().get(`/api/v1/sales?sellerId=${mgr2.id}`).set(bearer(mgr1.token))).body.total).toBe(0);
    expect((await ctx.http().get('/api/v1/sales?central=true').set(bearer(mgr1.token))).body.total).toBe(0);
    expect((await ctx.http().get('/api/v1/sales').set(bearer(staff))).status).toBe(403);
  });

  it('shows the whole stall to managers when sales.managerSeesWholeStall is on', async () => {
    await ctx.t.db.update(settings).set({ value: true }).where(eq(settings.key, 'sales.managerSeesWholeStall'));
    try {
      const res = await ctx.http().get('/api/v1/sales').set(bearer(mgr1.token));
      expect(res.body.items.map((i: { id: string }) => i.id).sort()).toEqual([s1.id, s2.id].sort());
      expect((await ctx.http().get(`/api/v1/sales/${s2.id}`).set(bearer(mgr1.token))).status).toBe(200);
      expect((await ctx.http().get(`/api/v1/sales/${central.id}`).set(bearer(mgr1.token))).status).toBe(404); // still no central sales
    } finally {
      await ctx.t.db.update(settings).set({ value: false }).where(eq(settings.key, 'sales.managerSeesWholeStall'));
    }
  });

  it('filters by stall, central, seller, payment, status, text and dates; paginates', async () => {
    const get = async (qs: string) => (await ctx.http().get(`/api/v1/sales?${qs}`).set(bearer(admin))).body;
    expect((await get(`stallId=${stallA}`)).total).toBe(2);
    expect((await get('central=true')).items.some((i: { id: string }) => i.id === central.id)).toBe(true);
    expect((await get('central=false&pageSize=100')).items.every((i: { stallId: string | null }) => i.stallId)).toBe(true);
    expect((await get(`sellerId=${mgr2.id}`)).items.map((i: { id: string }) => i.id)).toEqual([s2.id]);
    expect((await get(`stallId=${stallA}&paymentMethod=UPI`)).items.map((i: { id: string }) => i.id)).toEqual([s2.id]);
    expect((await get(`q=${s1.receiptNo.toLowerCase()}`)).items.map((i: { id: string }) => i.id)).toEqual([s1.id]);
    expect((await get(`q=${codes[1]}`)).items.map((i: { id: string }) => i.id)).toEqual([s2.id]);
    expect((await get('q=readable%20book&pageSize=100')).total).toBe(3);
    expect((await get('q=nothing-like-this')).total).toBe(0);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST calendar day
    expect((await get(`stallId=${stallA}&from=${today}&to=${today}`)).total).toBe(2);
    expect((await get(`stallId=${stallA}&to=2000-01-01`)).total).toBe(0);
    expect((await get(`stallId=${stallA}&from=${new Date(Date.now() + 60_000).toISOString()}`)).total).toBe(0);
    const p1 = await get(`stallId=${stallA}&pageSize=1&page=1`);
    expect(p1).toMatchObject({ total: 2, pageSize: 1 });
    expect(p1.items).toHaveLength(1);
    expect((await ctx.http().get('/api/v1/sales?paymentMethod=GOLD').set(bearer(admin))).status).toBe(400);
  });

  it('renders receipts (thermal and A6) for sales the caller may see', async () => {
    for (const fmt of ['thermal', 'a6']) {
      const res = await ctx.http().get(`/api/v1/sales/${s1.id}/receipt.pdf?format=${fmt}`).set(bearer(mgr1.token)).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    const thermal = await ctx.http().get(`/api/v1/sales/${s1.id}/receipt.pdf`).set(bearer(admin)).buffer(true).parse(binary);
    expect((thermal.body as Buffer).toString('latin1')).toMatch(/\/MediaBox \[0 0 226\.7\d* /); // 80 mm wide
    expect((await ctx.http().get(`/api/v1/sales/${s2.id}/receipt.pdf`).set(bearer(mgr1.token))).status).toBe(404);
    expect((await ctx.http().get(`/api/v1/sales/${s1.id}/receipt.pdf?format=big`).set(bearer(admin))).status).toBe(400);
  });

  it('exports to Excel for admins only, without customer contact details', async () => {
    await ctx.http().post('/api/v1/sales').set(bearer(admin)).send({ clientRef: ref(), paymentMethod: 'CASH', customerName: 'Private Person', customerPhone: '9999999999', items: [{ copyId: (await addBooks('Export', 1))[0]!.id }] });
    const res = await ctx.http().get('/api/v1/sales/export.xlsx?pageSize=5').set(bearer(admin)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sales', 'Items']);
    expect(wb.getWorksheet('Sales')!.rowCount).toBeGreaterThan(5);
    const text = JSON.stringify(wb.getWorksheet('Sales')!.getSheetValues()) + JSON.stringify(wb.getWorksheet('Items')!.getSheetValues());
    expect(text).not.toMatch(/Private Person|9999999999/);
    expect((await ctx.http().get('/api/v1/sales/export.xlsx').set(bearer(mgr1.token))).status).toBe(403);
  });
});

describe('voiding sales', () => {
  it('needs sale.void and a reason; restores the book to its original slot', async () => {
    const [book] = await addBooks('Void Me', 1, { price: 9000 });
    const sale = (await sell(admin, items(book!))).body;
    expect((await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(staff)).send({ reason: 'oops' })).status).toBe(403);
    const m = await ctx.userToken('void.mgr', 'STALL_MANAGER');
    expect((await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(m)).send({ reason: 'oops' })).status).toBe(403);
    expect((await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({})).status).toBe(400);
    expect((await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'x' })).status).toBe(400);

    const res = await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'Customer returned the book' });
    expect(res.status).toBe(200);
    expect(res.body.sale).toMatchObject({ status: 'VOIDED', voidReason: 'Customer returned the book', voidedBy: 'Administrator' });
    expect(res.body.restored).toEqual([{ code: book!.code, title: 'Void Me', locationCode: book!.locationCode, relocated: false }]);
    expect(res.body.labelPdfUrl).toBeNull();
    expect(await row(book!.id)).toMatchObject({ status: 'IN_STOCK', soldAt: null, rowId: expect.any(String), slotNumber: expect.any(Number) });
    const [log] = await ctx.t.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'sale.void'), eq(auditLogs.entityId, sale.id)));
    expect(log!.after).toMatchObject({ reason: 'Customer returned the book', status: 'VOIDED' });

    expect((await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'again please' })).status).toBe(409);
    // the book can be sold again and the second sale is independent
    expect((await sell(admin, items(book!))).status).toBe(201);
  });

  it('allocates a new slot, and flags the label, when the old one was taken in the meantime', async () => {
    const [book] = await addBooks('Slot Stolen', 1);
    const sale = (await sell(admin, items(book!))).body;
    const [thief] = await addBooks('Slot Thief', 1); // takes the freed slot
    expect(thief!.locationCode).toBe(book!.locationCode);
    const res = await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'mistake' });
    expect(res.body.restored[0]).toMatchObject({ relocated: true, locationCode: expect.stringMatching(/^FIC-A01-\d{3}$/) });
    expect(res.body.restored[0].locationCode).not.toBe(book!.locationCode);
    expect(res.body.labelPdfUrl).toContain(book!.id);
    expect(await row(book!.id)).toMatchObject({ status: 'IN_STOCK', labelNeedsPrint: true });
    const dupes = await ctx.t.db.execute(`SELECT row_id, slot_number FROM copies WHERE row_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1` as never);
    expect(dupes.rows).toHaveLength(0);
  });

  it('can put a stall sale back AT the stall while it is still active', async () => {
    const stallId = await newStall('Void Stall');
    const m = await newManager('voidstall.mgr', stallId);
    const [book] = await addBooks('Stall Void', 1);
    await sendToStall(stallId, [book!]);
    const sale = (await sell(m.token, items(book!))).body;

    const central = await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'wrong price shown', returnToStall: true });
    expect(central.status).toBe(200);
    expect(await row(book!.id)).toMatchObject({ status: 'AT_STALL', currentStallId: stallId, rowId: expect.any(String) });
    const open = await ctx.t.db.select().from(stallMovements).where(and(eq(stallMovements.copyId, book!.id), eq(stallMovements.outcome, 'OPEN')));
    expect(open).toHaveLength(1);
    // manager can sell it again
    expect((await sell(m.token, items(book!))).status).toBe(201);
  });

  it('refuses returnToStall for central sales and closed stalls, and defaults to the central shelf', async () => {
    const [cbook] = await addBooks('Central Void', 1);
    const csale = (await sell(admin, items(cbook!))).body;
    expect((await ctx.http().post(`/api/v1/sales/${csale.id}/void`).set(bearer(admin)).send({ reason: 'central one', returnToStall: true })).status).toBe(400);

    const stallId = await newStall('Closing Stall');
    const m = await newManager('closing.mgr', stallId);
    const [book] = await addBooks('Closed Stall Void', 1);
    await sendToStall(stallId, [book!]);
    const sale = (await sell(m.token, items(book!))).body;
    await ctx.t.db.update(stalls).set({ status: 'CLOSED', closedAt: new Date() }).where(eq(stalls.id, stallId));
    const blocked = await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'stall is closed', returnToStall: true });
    expect(blocked.body.error.code).toBe('STALL_NOT_ACTIVE');
    const ok = await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'stall is closed' });
    expect(ok.status).toBe(200);
    expect(await row(book!.id)).toMatchObject({ status: 'IN_STOCK', currentStallId: null });
  });
});

describe('GET /sales/summary', () => {
  it('has one row per stall plus Admin (central) and a grand total that adds up; voided sales excluded', async () => {
    const summary = await ctx.http().get('/api/v1/sales/summary?groupBy=stall').set(bearer(admin));
    expect(summary.status).toBe(200);
    const { rows, total } = summary.body;
    expect(rows[0]).toMatchObject({ key: 'central', label: 'Admin (central)' });
    const sum = (f: string) => rows.reduce((a: number, r: Record<string, number>) => a + r[f]!, 0);
    expect(total).toMatchObject({ revenueMinor: sum('revenueMinor'), salesCount: sum('salesCount'), itemsCount: sum('itemsCount') });
    for (const r of rows) expect(Object.values(r.byPaymentMethod as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(r.revenueMinor);

    // independent check against the database: completed sales only
    const check = (await ctx.t.db.execute(`SELECT coalesce(sum(total_minor),0)::int AS s, count(*)::int AS n FROM sales WHERE status = 'COMPLETED'` as never)).rows[0] as { s: number; n: number };
    expect(total.revenueMinor).toBe(check.s);
    expect(total.salesCount).toBe(check.n);

    const readStall = rows.find((r: { label: string }) => r.label === 'Read Stall');
    expect(readStall).toMatchObject({ salesCount: 2, itemsCount: 2, revenueMinor: 14000, byPaymentMethod: { CASH: 7000, UPI: 7000, CARD: 0, OTHER: 0 } });
  });

  it('lists active stalls even before their first sale', async () => {
    const quiet = await newStall('Quiet Stall');
    const rows = (await ctx.http().get('/api/v1/sales/summary?groupBy=stall').set(bearer(admin))).body.rows;
    expect(rows.find((r: { key: string }) => r.key === quiet)).toMatchObject({ label: 'Quiet Stall', revenueMinor: 0, salesCount: 0 });
  });

  it('groups by day, payment method and genre', async () => {
    const day = (await ctx.http().get('/api/v1/sales/summary?groupBy=day').set(bearer(admin))).body;
    expect(day.rows).toHaveLength(1);
    expect(day.rows[0].key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day.rows[0].revenueMinor).toBe(day.total.revenueMinor);

    const pay = (await ctx.http().get('/api/v1/sales/summary?groupBy=paymentMethod').set(bearer(admin))).body;
    expect(pay.rows.map((r: { key: string }) => r.key)).toEqual(['CASH', 'UPI', 'CARD', 'OTHER']);
    expect(pay.rows.reduce((a: number, r: { revenueMinor: number }) => a + r.revenueMinor, 0)).toBe(pay.total.revenueMinor);

    const genre = (await ctx.http().get('/api/v1/sales/summary?groupBy=genre').set(bearer(admin))).body;
    expect(genre.rows.map((r: { key: string }) => r.key)).toEqual(['FIC']);
    expect(genre.rows[0].revenueMinor).toBe(genre.total.revenueMinor);

    expect((await ctx.http().get('/api/v1/sales/summary?groupBy=moon').set(bearer(admin))).status).toBe(400);
    expect((await ctx.http().get('/api/v1/sales/summary?from=2000-01-01&to=2000-01-02').set(bearer(admin))).body.total.revenueMinor).toBe(0);
  });

  it("limits a manager to their own sales", async () => {
    const stallId = await newStall('Own Summary');
    const m = await newManager('own.sum', stallId);
    const [book] = await addBooks('Own', 1, { price: 3300 });
    await sendToStall(stallId, [book!]);
    await sell(m.token, items(book!));
    const res = await ctx.http().get('/api/v1/sales/summary?groupBy=stall').set(bearer(m.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toMatchObject({ revenueMinor: 3300, salesCount: 1 });
    expect(res.body.rows.map((r: { label: string }) => r.label)).toEqual(['Admin (central)', 'Own Summary']);
    expect((await ctx.http().get('/api/v1/sales/summary').set(bearer(staff))).status).toBe(403);
  });
});

describe('realtime (Socket.IO)', () => {
  const sockets: Socket[] = [];
  afterEach(() => {
    while (sockets.length) sockets.pop()!.disconnect();
  });
  const connect = (token: string | undefined) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(url, { path: '/rt/socket.io', transports: ['websocket'], auth: token ? { token } : {}, reconnection: false });
      sockets.push(s);
      s.on('connect', () => setTimeout(() => resolve(s), 100)); // let the server finish joining rooms
      s.on('connect_error', reject);
    });
  const nextEvent = (s: Socket, name: string, ms = 2000) =>
    new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no "${name}" within ${ms}ms`)), ms);
      s.once(name, (p) => (clearTimeout(t), resolve(p)));
    });
  const stays = async (s: Socket, name: string, ms = 600) => {
    let got = false;
    s.once(name, () => (got = true));
    await new Promise((r) => setTimeout(r, ms));
    return !got;
  };

  it('rejects connections without a valid token', async () => {
    await expect(connect(undefined)).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(connect('garbage')).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('pushes sale.created to admins and to the seller, but not to a co-manager (D6)', async () => {
    const stallId = await newStall('Live Stall');
    const seller = await newManager('live.seller', stallId);
    const coMgr = await newManager('live.co', stallId);
    const [book] = await addBooks('Live Book', 1, { price: 4200 });
    await sendToStall(stallId, [book!]);

    const adminSock = await connect(admin);
    const sellerSock = await connect(seller.token);
    const coSock = await connect(coMgr.token);
    const adminGot = nextEvent(adminSock, 'sale.created');
    const sellerGot = nextEvent(sellerSock, 'sale.created');
    const coQuiet = stays(coSock, 'sale.created');

    const sale = (await sell(seller.token, items(book!))).body;
    expect(await adminGot).toMatchObject({ saleId: sale.id, stallId, totalMinor: 4200, itemsCount: 1 });
    expect(await sellerGot).toMatchObject({ saleId: sale.id });
    expect(await coQuiet).toBe(true);
  });

  it('pushes inventory.changed to the stall room on checkout, and sale.voided to admins', async () => {
    const stallId = await newStall('Live Stall 2');
    const mgr = await newManager('live2.mgr', stallId);
    const [book] = await addBooks('Live Book 2', 1);
    const mgrSock = await connect(mgr.token);
    const adminSock = await connect(admin);
    const inv = nextEvent(mgrSock, 'inventory.changed');
    await sendToStall(stallId, [book!]);
    expect(await inv).toMatchObject({ stallId, copyIds: [book!.id] });

    const sale = (await sell(mgr.token, items(book!))).body;
    const voided = nextEvent(adminSock, 'sale.voided');
    await ctx.http().post(`/api/v1/sales/${sale.id}/void`).set(bearer(admin)).send({ reason: 'socket test' });
    expect(await voided).toMatchObject({ saleId: sale.id });
  });

  it('admins can subscribe to any stall room; others cannot', async () => {
    const stallId = await newStall('Watched');
    const adminSock = await connect(admin);
    expect(await adminSock.emitWithAck('subscribe:stall', { stallId })).toEqual({ ok: true });
    expect(await adminSock.emitWithAck('subscribe:stall', { stallId: 'nope' })).toEqual({ ok: false });
    const other = await newManager('watcher', undefined);
    const otherSock = await connect(other.token);
    expect(await otherSock.emitWithAck('subscribe:stall', { stallId })).toEqual({ ok: false });
  });

  it('kicks a user whose session is revoked', async () => {
    const victim = await newManager('kick.me', undefined);
    const sock = await connect(victim.token);
    const revoked = nextEvent(sock, 'session.revoked');
    const gone = new Promise<void>((r) => sock.once('disconnect', () => r()));
    await ctx.http().patch(`/api/v1/users/${victim.id}`).set(bearer(admin)).send({ isActive: false });
    await revoked;
    await gone;
    await expect(connect(victim.token)).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('warns admins when a genre is nearly full', async () => {
    await ctx.t.db.update(settings).set({ value: 1 }).where(eq(settings.key, 'shelf.lowSpaceThresholdPercent'));
    const adminSock = await connect(admin);
    const low = nextEvent(adminSock, 'shelf.space.low');
    await addBooks('Space Hog', 1, { genre: 'SFF' });
    expect(await low).toMatchObject({ code: 'SFF', percentFull: expect.any(Number) });
    await ctx.t.db.update(settings).set({ value: 90 }).where(eq(settings.key, 'shelf.lowSpaceThresholdPercent'));
  });
});
