import http from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLogs, bookTitles, copies, genres } from '../src/db/schema/index.js';
import { safeFetchImage, UnsafeUrlError } from '../src/modules/covers/safe-fetch.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let admin: string;
let staff: string;
let manager: string;
const g: Record<string, string> = {};
let png: Buffer;
let server: http.Server;
let base: string;

const body = (over: Record<string, unknown> = {}) => ({
  clientRef: crypto.randomUUID(),
  quantity: 1,
  copy: { condition: 'GOOD', originalPriceMinor: 39900, sellingPriceMinor: 14000 },
  ...over,
});
const manualTitle = (name: string, genre = 'FIC', extra: Record<string, unknown> = {}) => ({
  title: { title: name, authors: ['Some Author'], genreId: g[genre], ...extra },
});
const post = (token: string, b: unknown) => ctx.http().post('/api/v1/copies').set(bearer(token)).send(b as object);

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  manager = await ctx.userToken('mgr1', 'STALL_MANAGER');
  for (const row of await ctx.t.db.select().from(genres)) g[row.code] = row.id;

  png = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#3355aa' } }).png().toBuffer();
  server = http.createServer((req, res) => {
    if (req.url === '/cover.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(png);
    if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
    if (req.url === '/html') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<p>no</p>');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await ctx.close();
});

describe('POST /copies', () => {
  let titleId: string;

  it('creates a title and 3 copies with sequential codes and contiguous slots', async () => {
    const res = await post(staff, body({
      quantity: 3,
      title: {
        isbn13: '978-0-14-312755-0', title: 'Everything I Never Told You', authors: ['Celeste Ng'], genreId: g.FIC,
        source: 'OPEN_LIBRARY', coverUrl: `${base}/cover.png`, publishedYear: 2015, language: 'en',
      },
    }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.copies.map((c: { code: string }) => c.code)).toEqual(['BK0000001', 'BK0000002', 'BK0000003']);
    expect(res.body.copies.map((c: { locationCode: string }) => c.locationCode)).toEqual(['FIC-A01-001', 'FIC-A01-002', 'FIC-A01-003']);
    expect(res.body.copies.every((c: { labelNeedsPrint: boolean; status: string }) => c.labelNeedsPrint && c.status === 'IN_STOCK')).toBe(true);
    expect(res.body.title).toMatchObject({ isbn13: '9780143127550', isbn10: '0143127551', title: 'Everything I Never Told You', version: 0 });
    expect(res.body.labelPdfUrl).toMatch(/^\/api\/v1\/labels\/pdf\?copyIds=/);
    titleId = res.body.title.id;
  });

  it('fetches the cover in the background and serves it publicly as WebP', async () => {
    expect(ctx.jobs.pending.some((j) => j.name === 'cover.fetch')).toBe(true);
    await ctx.jobs.drain();
    expect(ctx.jobs.failures).toEqual([]);
    const [t] = await ctx.t.db.select().from(bookTitles).where(eq(bookTitles.id, titleId));
    expect(t!.coverKey).toBe(`covers/${titleId}/400.webp`);
    const img = await ctx.http().get(`/api/v1/files/covers/${titleId}/400.webp`).buffer(true).parse((r, cb) => {
      const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(img.status).toBe(200); // no auth header
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toMatch(/max-age=86400/);
    const meta = await sharp(img.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 400 });
    const thumb = await sharp((await ctx.http().get(`/api/v1/files/covers/${titleId}/160.webp`).buffer(true).parse((r, cb) => {
      const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c)));
    })).body as Buffer).metadata();
    expect(thumb.width).toBe(160);
    expect((await ctx.http().get(`/api/v1/files/covers/${titleId}/999.webp`)).status).toBe(404);
  });

  it('reuses the title for the same ISBN and groups copies by condition and price', async () => {
    const res = await post(staff, body({
      copy: { condition: 'FAIR', sellingPriceMinor: 8000 },
      title: { isbn13: '9780143127550', title: 'IGNORED NEW METADATA', genreId: g.SCI },
    }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['TITLE_EXISTS_METADATA_IGNORED']);
    expect(res.body.title.id).toBe(titleId);
    expect(res.body.title.title).toBe('Everything I Never Told You');

    const detail = await ctx.http().get(`/api/v1/titles/${titleId}`).set(bearer(staff));
    expect(detail.status).toBe(200);
    expect(detail.body.copyGroups).toHaveLength(2);
    expect(detail.body.copyGroups.map((x: { condition: string; quantity: number }) => [x.condition, x.quantity]).sort()).toEqual([['FAIR', 1], ['GOOD', 3]]);
    expect(detail.body.coverUrl).toMatch(/\/files\/covers\//);
  });

  it('is idempotent on clientRef', async () => {
    const b = body(manualTitle('Idempotent Book', 'CLS', { source: 'MANUAL' }));
    const [one, two] = [await post(staff, b), await post(staff, b)];
    expect(two.status).toBe(201);
    expect(two.body).toEqual(one.body);
    const n = await ctx.t.db.select().from(copies).where(eq(copies.titleId, one.body.title.id));
    expect(n).toHaveLength(1);
  });

  it('accepts manual entry with no ISBN', async () => {
    const res = await post(admin, body(manualTitle('हिन्दी की किताब', 'HIN', { language: 'hi' })));
    expect(res.status).toBe(201);
    expect(res.body.title).toMatchObject({ isbn13: null, title: 'हिन्दी की किताब', language: 'hi' });
    // HIN has no sample row, so it spills to the overflow row, labelled with the book's own genre
    expect(res.body.copies[0].locationCode).toMatch(/^HIN-C05-/);
  });

  it('adds a copy to an existing title by titleId', async () => {
    const res = await post(staff, body({ titleId }));
    expect(res.status).toBe(201);
    expect(res.body.title.id).toBe(titleId);
    expect((await post(staff, body({ titleId: crypto.randomUUID() }))).status).toBe(404);
  });

  it('20 parallel requests get 20 distinct slots', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post(staff, body(manualTitle(`Parallel ${i}`, 'MYS')))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const locs = results.map((r) => r.body.copies[0].locationCode);
    expect(new Set(locs).size).toBe(20);
    expect(new Set(results.map((r) => r.body.copies[0].code)).size).toBe(20);
  });

  it('warns NO_SHELF_SPACE and leaves the overflow remainder unshelved', async () => {
    // ART has no row; overflow C05 (40 slots) already holds 1 HIN copy → 39 fit, 6 do not
    const res = await post(staff, body({ ...manualTitle('Big Art Book', 'ART'), quantity: 45 }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['NO_SHELF_SPACE']);
    const placed = res.body.copies.filter((c: { locationCode: string | null }) => c.locationCode);
    expect(placed).toHaveLength(39);
    expect(res.body.copies.filter((c: { locationCode: string | null }) => !c.locationCode)).toHaveLength(6);
  });

  it('validates input and permissions', async () => {
    expect((await post(manager, body(manualTitle('X')))).status).toBe(403);
    expect((await post(staff, body({ ...manualTitle('X'), quantity: 0 }))).status).toBe(400);
    expect((await post(staff, body({ ...manualTitle('X'), quantity: 201 }))).status).toBe(400);
    expect((await post(staff, body({ title: { title: 'X', genreId: g.FIC, isbn13: '9780143127551' } }))).status).toBe(400);
    expect((await post(staff, body({}))).status).toBe(400); // neither titleId nor title
    expect((await post(staff, body({ titleId, ...manualTitle('X') }))).status).toBe(400); // both
    expect((await post(staff, { ...body(manualTitle('X')), clientRef: 'nope' })).status).toBe(400);
    expect((await post(staff, body({ title: { title: 'X', genreId: crypto.randomUUID() } }))).status).toBe(400);
    expect((await ctx.http().post('/api/v1/copies').send(body(manualTitle('X')))).status).toBe(401);
  });

  it('rolls back the whole request when anything fails (no orphan title or slots)', async () => {
    const before = (await ctx.t.db.execute(sql`SELECT count(*)::int AS n FROM book_titles`)).rows[0]!.n;
    await post(staff, body({ title: { title: 'Orphan?', genreId: g.FIC, summary: 'x'.repeat(5000) } })); // fails validation
    expect((await ctx.t.db.execute(sql`SELECT count(*)::int AS n FROM book_titles`)).rows[0]!.n).toBe(before);
  });
});

describe('copy read/update/write-off/move', () => {
  let copy: { id: string; code: string; version: number };
  let titleId: string;

  beforeAll(async () => {
    const res = await post(staff, body({ ...manualTitle('Editable Book', 'ROM'), quantity: 2 }));
    copy = res.body.copies[0];
    titleId = res.body.title.id;
  });

  it('returns full detail by id and by code (case-insensitive)', async () => {
    const byId = await ctx.http().get(`/api/v1/copies/${copy.id}`).set(bearer(staff));
    const byCode = await ctx.http().get(`/api/v1/copies/by-code/${copy.code.toLowerCase()}`).set(bearer(admin));
    expect(byId.status).toBe(200);
    expect(byCode.body.id).toBe(copy.id);
    expect(byId.body).toMatchObject({ title: { title: 'Editable Book', genre: { code: 'ROM' } }, stall: null, openMovement: null, sale: null, movements: [] });
    expect((await ctx.http().get('/api/v1/copies/by-code/BK9999999').set(bearer(staff))).status).toBe(404);
  });

  it('hides central stock from stall managers', async () => {
    expect((await ctx.http().get(`/api/v1/copies/${copy.id}`).set(bearer(manager))).status).toBe(404);
    expect((await ctx.http().get(`/api/v1/titles/${titleId}`).set(bearer(manager))).status).toBe(404);
  });

  it('price edits flag the label for reprint and are audited; stale versions conflict', async () => {
    const ok = await ctx.http().patch(`/api/v1/copies/${copy.id}`).set(bearer(staff)).send({ version: copy.version, sellingPriceMinor: 9000 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sellingPriceMinor: 9000, labelNeedsPrint: true, version: copy.version + 1 });

    const stale = await ctx.http().patch(`/api/v1/copies/${copy.id}`).set(bearer(staff)).send({ version: copy.version, notes: 'late' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const logs = await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, 'copy.price.update'));
    expect(logs.at(-1)).toMatchObject({ entityId: copy.id, before: { sellingPriceMinor: 14000 }, after: { sellingPriceMinor: 9000 } });
    copy.version = ok.body.version;
  });

  it('rejects empty updates and managers', async () => {
    expect((await ctx.http().patch(`/api/v1/copies/${copy.id}`).set(bearer(staff)).send({ version: copy.version })).status).toBe(400);
    expect((await ctx.http().patch(`/api/v1/copies/${copy.id}`).set(bearer(manager)).send({ version: copy.version, notes: 'x' })).status).toBe(403);
  });

  it('moves a copy automatically or to a chosen free slot, and refuses taken or out-of-range slots', async () => {
    const detail = await ctx.http().get(`/api/v1/copies/${copy.id}`).set(bearer(staff));
    const rowId = detail.body.rowId as string;
    const manual = await ctx.http().post(`/api/v1/copies/${copy.id}/move`).set(bearer(staff)).send({ rowId, slot: 40 });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ slotNumber: 40, locationCode: 'ROM-A04-040', labelNeedsPrint: true });
    const taken = await ctx.http().post(`/api/v1/copies/${copy.id}/move`).set(bearer(staff)).send({ rowId, slot: 40 });
    expect(taken.status).toBe(409);
    expect((await ctx.http().post(`/api/v1/copies/${copy.id}/move`).set(bearer(staff)).send({ rowId, slot: 41 })).status).toBe(400);
    const auto = await ctx.http().post(`/api/v1/copies/${copy.id}/move`).set(bearer(staff)).send({ auto: true });
    expect(auto.body.slotNumber).toBe(1);
  });

  it('write-off needs copy.writeoff, frees the slot, and cannot be repeated', async () => {
    const before = await ctx.http().get(`/api/v1/copies/${copy.id}`).set(bearer(admin));
    expect((await ctx.http().post(`/api/v1/copies/${copy.id}/write-off`).set(bearer(staff)).send({ reason: 'DAMAGED' })).status).toBe(403);
    const res = await ctx.http().post(`/api/v1/copies/${copy.id}/write-off`).set(bearer(admin)).send({ reason: 'DAMAGED', notes: 'water damage' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'WRITTEN_OFF', rowId: null, locationCode: null });
    const [row] = await ctx.t.db.select().from(copies).where(eq(copies.id, copy.id));
    expect(row).toMatchObject({ writeoffReason: 'DAMAGED', lastLocationCode: before.body.locationCode, notes: 'water damage' });
    expect((await ctx.http().post(`/api/v1/copies/${copy.id}/write-off`).set(bearer(admin)).send({ reason: 'LOST' })).status).toBe(409);
    expect((await ctx.http().patch(`/api/v1/copies/${copy.id}`).set(bearer(admin)).send({ version: res.body.version, notes: 'x' })).status).toBe(409);
    // the freed slot is handed out again
    const next = await post(staff, body(manualTitle('Next', 'ROM')));
    expect(next.body.copies[0].locationCode).toBe(before.body.locationCode.replace(/-\d+$/, '-001'));
  });
});

describe('title edits, cover upload and relocation', () => {
  let titleId: string;
  let version: number;

  beforeAll(async () => {
    const res = await post(staff, body({ ...manualTitle('The Old Genre Book', 'HIS'), quantity: 3 }));
    titleId = res.body.title.id;
    version = res.body.title.version;
  });

  it('edits metadata with optimistic locking and recomputes sort/search columns', async () => {
    const ok = await ctx.http().patch(`/api/v1/titles/${titleId}`).set(bearer(staff)).send({ version, title: 'The Renamed Book', authors: ['Jane Q. Public'] });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toMatchObject({ title: 'The Renamed Book', version: version + 1 });
    expect(ok.body.requiresRelocation).toBe(0);
    const [row] = await ctx.t.db.select().from(bookTitles).where(eq(bookTitles.id, titleId));
    expect(row).toMatchObject({ titleSort: 'renamed book', authorSort: 'public jane q', searchText: 'the renamed book jane q public' });
    const stale = await ctx.http().patch(`/api/v1/titles/${titleId}`).set(bearer(staff)).send({ version, title: 'Nope' });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    version = ok.body.title.version;
  });

  it('uploads a cover photo (multipart) and rejects non-images', async () => {
    const ok = await ctx.http().post(`/api/v1/titles/${titleId}/cover`).set(bearer(staff)).attach('file', png, { filename: 'c.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);
    expect(ok.body.coverUrl).toMatch(/400\.webp/);
    const bad = await ctx.http().post(`/api/v1/titles/${titleId}/cover`).set(bearer(staff)).attach('file', Buffer.from('not an image'), { filename: 'c.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
    const wrongType = await ctx.http().post(`/api/v1/titles/${titleId}/cover`).set(bearer(staff)).attach('file', Buffer.from('x'), { filename: 'c.txt', contentType: 'text/plain' });
    expect(wrongType.status).toBe(400);
    expect((await ctx.http().post(`/api/v1/titles/${titleId}/cover`).set(bearer(manager)).attach('file', png, { filename: 'c.png', contentType: 'image/png' })).status).toBe(403);
    version = (await ctx.http().get(`/api/v1/titles/${titleId}`).set(bearer(staff))).body.version;
  });

  it('a genre change reports how many copies need relocating and never moves them by itself', async () => {
    const res = await ctx.http().patch(`/api/v1/titles/${titleId}`).set(bearer(staff)).send({ version, genreId: g.BIO });
    expect(res.status).toBe(200);
    expect(res.body.requiresRelocation).toBe(3);
    const stillThere = await ctx.t.db.select().from(copies).where(eq(copies.titleId, titleId));
    expect(stillThere.every((c) => c.lastLocationCode?.startsWith('HIS-'))).toBe(true);
  });

  it('relocate moves the copies into the new genre rows and flags labels for reprint', async () => {
    const res = await ctx.http().post(`/api/v1/titles/${titleId}/relocate`).set(bearer(staff));
    expect(res.status).toBe(201);
    expect(res.body.notMoved).toBe(0);
    expect(res.body.moves).toHaveLength(3);
    expect(res.body.moves[0]).toMatchObject({ from: expect.stringMatching(/^HIS-/), to: expect.stringMatching(/^BIO-/) });
    const rows = await ctx.t.db.select().from(copies).where(eq(copies.titleId, titleId));
    expect(rows.every((c) => c.lastLocationCode?.startsWith('BIO-') && c.labelNeedsPrint)).toBe(true);
    // idempotent once everything is in place
    expect((await ctx.http().post(`/api/v1/titles/${titleId}/relocate`).set(bearer(staff))).body.moves).toEqual([]);
  });
});

describe('safeFetchImage', () => {
  const opts = { maxBytes: 1_000_000, timeoutMs: 3000, maxRedirects: 3 };
  it('refuses loopback and non-http URLs unless explicitly allowed', async () => {
    await expect(safeFetchImage(`${base}/cover.png`, opts)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetchImage('file:///etc/passwd', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetchImage('http://169.254.169.254/latest/meta-data', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetchImage('http://[::1]/x', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it('enforces content type, size and redirect limits', async () => {
    const allow = { ...opts, allowPrivate: true };
    expect((await safeFetchImage(`${base}/cover.png`, allow)).length).toBeGreaterThan(100);
    await expect(safeFetchImage(`${base}/html`, allow)).rejects.toThrow(/Not an image/);
    await expect(safeFetchImage(`${base}/cover.png`, { ...allow, maxBytes: 100 })).rejects.toThrow(/too large/);
    await expect(safeFetchImage(`${base}/loop`, allow)).rejects.toThrow(/Too many redirects/);
  });
});

describe('maintenance', () => {
  it('purges old lookup-cache rows and idempotency keys only', async () => {
    const { MaintenanceService } = await import('../src/modules/maintenance/maintenance.service.js');
    const svc = ctx.app.get(MaintenanceService);
    await ctx.t.db.execute(sql`INSERT INTO external_lookup_cache (provider, lookup_key, payload, fetched_at) VALUES ('openlibrary','isbn:old',NULL, now() - interval '100 days'), ('openlibrary','isbn:new',NULL, now())`);
    await ctx.t.db.execute(sql`UPDATE idempotency_keys SET created_at = now() - interval '8 days' WHERE ctid IN (SELECT ctid FROM idempotency_keys LIMIT 1)`);
    const r = await svc.purge();
    expect(r).toEqual({ lookups: 1, keys: 1 });
    expect((await ctx.t.db.execute(sql`SELECT count(*)::int AS n FROM external_lookup_cache WHERE lookup_key = 'isbn:new'`)).rows[0]!.n).toBe(1);
  });
});
