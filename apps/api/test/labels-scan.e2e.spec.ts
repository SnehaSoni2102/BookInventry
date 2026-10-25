import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { copies, genres, settings, stallAssignments, stalls, users } from '../src/db/schema/index.js';
import { sheetPositions } from '../src/modules/labels/label-render.js';
import { createPdf, truncate, wrapLines } from '../src/common/pdf/pdf-text.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let admin: string;
let staff: string;
let manager: string;
let managerId: string;
const g: Record<string, string> = {};
let titleId: string;
let copyA: { id: string; code: string; version: number; locationCode: string };
let copyB: { id: string; code: string };
let copyC: { id: string; code: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};
const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const getPdf = (token: string, qs: string) =>
  ctx.http().get(`/api/v1/labels/pdf?${qs}`).set(bearer(token)).buffer(true).parse(binary as never);

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  manager = await ctx.userToken('mgr1', 'STALL_MANAGER');
  managerId = (await ctx.t.db.select().from(users).where(eq(users.username, 'mgr1')))[0]!.id;
  for (const row of await ctx.t.db.select().from(genres)) g[row.code] = row.id;

  const create = async (title: string, over: Record<string, unknown> = {}) =>
    (await ctx.http().post('/api/v1/copies').set(bearer(staff)).send({
      clientRef: crypto.randomUUID(), quantity: 1,
      copy: { condition: 'GOOD', originalPriceMinor: 39900, sellingPriceMinor: 15000, donorName: 'Secret Donor', notes: 'internal note' },
      title: { title, authors: ['Arundhati Roy'], genreId: g.FIC, summary: 'A tale of twins.', isbn13: '9780143127550' },
      ...over,
    })).body;
  const a = await create('The God of Small Things and a Very Long Subtitle That Never Fits On A Small Label');
  titleId = a.title.id;
  copyA = a.copies[0];
  const b = await create('x', { title: undefined, titleId, copy: { condition: 'FAIR', sellingPriceMinor: 8000 } });
  copyB = b.copies[0];
  const c = await create('हिन्दी की किताब', { title: { title: 'हिन्दी की किताब', authors: ['प्रेमचंद'], genreId: g.HIN, language: 'hi' } });
  copyC = c.copies[0];
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await ctx.close();
});

describe('label layout helpers', () => {
  it('maps sheet positions, honouring the start cell and spilling to new pages', () => {
    expect(sheetPositions(1, 3)).toEqual([{ page: 0, col: 0, row: 0 }, { page: 0, col: 1, row: 0 }, { page: 0, col: 2, row: 0 }]);
    expect(sheetPositions(24, 2)).toEqual([{ page: 0, col: 2, row: 7 }, { page: 1, col: 0, row: 0 }]);
    expect(sheetPositions(5, 1)).toEqual([{ page: 0, col: 1, row: 1 }]);
  });
  it('truncates long titles with an ellipsis within the width', () => {
    const doc = createPdf();
    doc.addPage();
    const lines = wrapLines(doc, 'The God of Small Things and a Very Long Subtitle That Never Fits On A Small Label', 72, 2, { size: 7, bold: true });
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(truncate(doc, 'short', 72, { size: 7 })).toBe('short');
    // mixed Latin + Devanagari + rupee sign must measure without throwing
    expect(truncate(doc, 'हिन्दी की किताब ₹150', 40, { size: 7 }).length).toBeGreaterThan(0);
  });
});

describe('labels', () => {
  it('renders a thermal label PDF, one page per copy, in the requested order', async () => {
    const res = await getPdf(staff, `copyIds=${copyB.id},${copyA.id},${copyC.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPages(buf)).toBe(3);
    expect(buf.toString('latin1')).toMatch(/\/MediaBox \[0 0 141\.7\d* 70\.8\d*\]/); // 50 × 25 mm
  });

  it('renders the 1D template at 50 × 30 mm and the A4 sheet with a start position', async () => {
    const oneD = await getPdf(staff, `copyIds=${copyA.id}&template=THERMAL_50x30_1D`);
    expect(oneD.body.toString('latin1')).toMatch(/\/MediaBox \[0 0 141\.7\d* 85\.0\d*\]/);

    const a4 = await getPdf(staff, `copyIds=${copyA.id},${copyB.id},${copyC.id}&template=A4_24&startPosition=23`);
    expect(a4.status).toBe(200);
    expect(pdfPages(a4.body as Buffer)).toBe(2); // cells 23, 24 on page 1, cell 25 → page 2
    expect(a4.body.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
  });

  it('uses the default template from settings', async () => {
    await ctx.t.db.update(settings).set({ value: 'A4_24' }).where(eq(settings.key, 'label.defaultTemplate'));
    const res = await getPdf(admin, `copyIds=${copyA.id}`);
    expect(res.body.toString('latin1')).toMatch(/\/MediaBox \[0 0 595/);
    await ctx.t.db.update(settings).set({ value: 'THERMAL_50x25' }).where(eq(settings.key, 'label.defaultTemplate'));
  });

  it('validates the request', async () => {
    expect((await getPdf(staff, 'copyIds=not-a-uuid')).status).toBe(400);
    expect((await getPdf(staff, '')).status).toBe(400);
    expect((await getPdf(staff, `copyIds=${copyA.id}&template=BIG`)).status).toBe(400);
    expect((await getPdf(staff, `copyIds=${crypto.randomUUID()}`)).status).toBe(404);
    const post = (n: number) =>
      ctx.http().post('/api/v1/labels/pdf').set(bearer(staff)).send({ copyIds: Array.from({ length: n }, () => crypto.randomUUID()) });
    expect((await post(501)).status).toBe(400); // over the 500 limit
    expect((await post(0)).status).toBe(400);
  });

  it('prints big batches (500 labels) through POST, since 500 ids do not fit in a URL', async () => {
    const res = await ctx.http().post('/api/v1/labels/pdf').set(bearer(staff))
      .send({ copyIds: [copyA.id, copyB.id, copyC.id], template: 'A4_24', startPosition: 24 })
      .buffer(true).parse(binary);
    expect(res.status).toBe(201);
    expect(pdfPages(res.body as Buffer)).toBe(2);
  });

  it('lets managers print only labels of books at their own stall', async () => {
    const res = await getPdf(manager, `copyIds=${copyA.id}`);
    expect(res.status).toBe(409);
  });

  it('serves the QR as SVG', async () => {
    const res = await ctx.http().get(`/api/v1/copies/${copyA.id}/qr.svg`).set(bearer(staff)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect((res.body as Buffer).toString()).toContain('<svg');
  });

  it('keeps a print queue that mark-printed clears', async () => {
    const q = await ctx.http().get('/api/v1/labels/queue?createdBy=me').set(bearer(staff));
    expect(q.status).toBe(200);
    expect(q.body.total).toBe(3);
    expect(q.body.items.map((i: { code: string }) => i.code).sort()).toEqual([copyA.code, copyB.code, copyC.code].sort());
    expect((await ctx.http().get('/api/v1/labels/queue?createdBy=me').set(bearer(admin))).body.total).toBe(0);

    expect((await ctx.http().post('/api/v1/labels/mark-printed').set(bearer(manager)).send({ copyIds: [copyA.id] })).status).toBe(403);
    const done = await ctx.http().post('/api/v1/labels/mark-printed').set(bearer(staff)).send({ copyIds: [copyA.id, copyB.id] });
    expect(done.body).toEqual({ updated: 2 });
    expect((await ctx.http().get('/api/v1/labels/queue').set(bearer(staff))).body.total).toBe(1);
    const [row] = await ctx.t.db.select().from(copies).where(eq(copies.id, copyA.id));
    expect(row!.labelPrintedAt).toBeInstanceOf(Date);

    // a price change puts it back in the queue
    const cur = await ctx.http().get(`/api/v1/copies/${copyA.id}`).set(bearer(staff));
    await ctx.http().patch(`/api/v1/copies/${copyA.id}`).set(bearer(staff)).send({ version: cur.body.version, sellingPriceMinor: 16000 });
    expect((await ctx.http().get('/api/v1/labels/queue').set(bearer(staff))).body.total).toBe(2);
    copyA.locationCode = cur.body.locationCode;
  });
});

describe('GET /scan/resolve', () => {
  const resolve = (token: string, value: string) => ctx.http().get('/api/v1/scan/resolve').query({ value }).set(bearer(token));
  const actionNames = (body: { actions: Array<{ action: string }> }) => body.actions.map((a) => a.action).sort();

  it('resolves a copy code, a label URL on any host, and lower case', async () => {
    for (const value of [copyA.code, copyA.code.toLowerCase(), `https://some-old-domain.org/b/${copyA.code}`]) {
      const res = await resolve(staff, value);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kind: 'copy', copy: { code: copyA.code, locationCode: copyA.locationCode } });
    }
  });

  it('offers actions by permission × status', async () => {
    expect(actionNames((await resolve(staff, copyA.code)).body)).toEqual(['CHECKOUT', 'EDIT', 'PRINT_LABEL']);
    expect(actionNames((await resolve(admin, copyA.code)).body)).toEqual(['CHECKOUT', 'EDIT', 'PRINT_LABEL', 'SELL', 'WRITE_OFF']);
  });

  it('for a copy at a stall: staff can check in (with the return location), admin sells after confirming, manager sells', async () => {
    const [stall] = await ctx.t.db.insert(stalls).values({ name: 'Diwali Mela', status: 'ACTIVE', activatedAt: new Date() }).returning();
    await ctx.t.db.insert(stallAssignments).values({ stallId: stall!.id, userId: managerId });
    await ctx.t.db.update(copies).set({ status: 'AT_STALL', currentStallId: stall!.id }).where(eq(copies.id, copyB.id));

    const staffView = await resolve(staff, copyB.code);
    expect(actionNames(staffView.body)).toEqual(['CHECKIN', 'EDIT', 'PRINT_LABEL']);
    expect(staffView.body.actions.find((a: { action: string }) => a.action === 'CHECKIN')).toMatchObject({
      stall: { name: 'Diwali Mela' }, returnToLocation: staffView.body.copy.locationCode,
    });
    expect(staffView.body.copy.locationCode).toMatch(/^FIC-/); // still reserved while out

    const adminView = await resolve(admin, copyB.code);
    expect(adminView.body.actions.find((a: { action: string }) => a.action === 'SELL')).toMatchObject({ requiresConfirm: 'COPY_AT_STALL' });

    const mgrView = await resolve(manager, copyB.code);
    expect(actionNames(mgrView.body)).toEqual(['PRINT_LABEL', 'SELL']);
    expect(mgrView.body.copy.stall.name).toBe('Diwali Mela');

    // stall closed → manager can no longer sell from it
    await ctx.t.db.update(stalls).set({ status: 'CLOSED' }).where(eq(stalls.id, stall!.id));
    expect(actionNames((await resolve(manager, copyB.code)).body)).toEqual(['PRINT_LABEL']);
    await ctx.t.db.update(stalls).set({ status: 'ACTIVE' }).where(eq(stalls.id, stall!.id));
  });

  it('shows a manager only limited info, and no actions, for a book that is not at their stall', async () => {
    const res = await resolve(manager, copyA.code);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: 'copy', blocked: 'COPY_NOT_AT_YOUR_STALL', copy: { code: copyA.code, title: expect.any(String), authors: ['Arundhati Roy'] }, actions: [] });
  });

  it('resolves ISBNs: local title with copy groups, or a catalogue lookup for people who can add books', async () => {
    const local = await resolve(staff, '978-0-14-312755-0');
    expect(local.body).toMatchObject({ kind: 'isbn', isbn13: '9780143127550', titleId });
    expect(local.body.copyGroups.length).toBeGreaterThan(0);

    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    const fresh = await resolve(staff, '9780306406157');
    expect(fresh.body).toMatchObject({ kind: 'isbn', isbn13: '9780306406157', lookup: { found: false } });
    const asManager = await resolve(manager, '9780306406157');
    expect(asManager.body).toEqual({ kind: 'isbn', isbn13: '9780306406157' });
  });

  it('answers unknown for junk, 404 for an unknown copy code, 401 when signed out', async () => {
    expect((await resolve(staff, 'hello world')).body).toEqual({ kind: 'unknown', raw: 'hello world' });
    expect((await resolve(staff, 'BK9999999')).status).toBe(404);
    expect((await ctx.http().get('/api/v1/scan/resolve?value=BK0000001')).status).toBe(401);
  });
});

describe('GET /public/copies/:code', () => {
  const pub = (code: string) => ctx.http().get(`/api/v1/public/copies/${code}`);

  it('shows the allowed fields without any login and leaks nothing internal', async () => {
    const res = await pub(copyA.code.toLowerCase());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: copyA.code, orgName: 'Goonj', availability: 'AVAILABLE', title: expect.stringContaining('God of Small Things'),
      authors: ['Arundhati Roy'], genre: { code: 'FIC' }, condition: 'GOOD', sellingPriceMinor: 16000, originalPriceMinor: 39900,
      summary: 'A tale of twins.',
    });
    const text = JSON.stringify(res.body);
    for (const secret of ['Secret Donor', 'internal note', copyA.id, titleId, copyA.locationCode, 'FIC-A01', 'rowId', 'stall', 'donor']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(Object.keys(res.body).sort()).toEqual(
      ['authors', 'availability', 'code', 'condition', 'coverUrl', 'genre', 'orgName', 'originalPriceMinor', 'sellingPriceMinor', 'summary', 'title'].sort(),
    );
  });

  it('does not expose the stall a book is at', async () => {
    const res = await pub(copyB.code);
    expect(res.body.availability).toBe('AVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/Diwali|stall/i);
  });

  it('reports sold and written-off copies', async () => {
    await ctx.t.db.update(copies).set({ status: 'SOLD', soldAt: new Date(), rowId: null, slotNumber: null, currentStallId: null }).where(eq(copies.id, copyB.id));
    expect((await pub(copyB.code)).body.availability).toBe('SOLD');
    await ctx.t.db.update(copies).set({ status: 'WRITTEN_OFF', writeoffReason: 'LOST', soldAt: null }).where(eq(copies.id, copyB.id));
    expect((await pub(copyB.code)).body.availability).toBe('UNAVAILABLE');
  });

  it('honours public.fields and public.enabled', async () => {
    await ctx.t.db.update(settings).set({ value: ['title', 'availability'] }).where(eq(settings.key, 'public.fields'));
    const slim = await pub(copyA.code);
    expect(Object.keys(slim.body).sort()).toEqual(['availability', 'code', 'orgName', 'title']);
    await ctx.t.db.update(settings).set({ value: false }).where(eq(settings.key, 'public.enabled'));
    expect((await pub(copyA.code)).status).toBe(404);
    await ctx.t.db.update(settings).set({ value: true }).where(eq(settings.key, 'public.enabled'));
  });

  it('404s for unknown or malformed codes', async () => {
    expect((await pub('BK9999999')).status).toBe(404);
    expect((await pub('nonsense')).status).toBe(404);
  });
});
