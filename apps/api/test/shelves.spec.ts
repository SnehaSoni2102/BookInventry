import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bookTitles, copies, genres, racks, shelfRows, users } from '../src/db/schema/index.js';
import { ShelfAllocationService } from '../src/modules/shelves/shelf-allocation.service.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let adminToken: string;
let staffToken: string;
let creatorId: string;
const alloc = new ShelfAllocationService();
const g: Record<string, string> = {};
let n = 0;

async function newTitle(genreCode: string) {
  const [t] = await ctx.t.db
    .insert(bookTitles)
    .values({ title: `T${++n}`, titleSort: `t${n}`, searchText: `t${n}`, genreId: g[genreCode]!, source: 'MANUAL' })
    .returning();
  return t!.id;
}

/** Mimics what CopiesService will do: allocate and insert in one transaction. */
async function createCopies(genreCode: string, count: number, contiguous = true) {
  const titleId = await newTitle(genreCode);
  return ctx.t.db.transaction(async (tx) => {
    const r = await alloc.allocate(tx, g[genreCode]!, count, contiguous);
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = r.placements[i];
      const [row] = await tx
        .insert(copies)
        .values({
          code: `BK${String(1_000_000 + ++n)}`, titleId, condition: 'GOOD', sellingPriceMinor: 5000, createdById: creatorId,
          rowId: p?.rowId ?? null, slotNumber: p?.slot ?? null, lastLocationCode: p?.locationCode ?? null,
        })
        .returning();
      out.push({ copy: row!, location: p?.locationCode });
    }
    return { copies: out, unplaced: r.unplaced };
  });
}

beforeAll(async () => {
  ctx = await createTestApp({ sampleShelves: false });
  adminToken = (await ctx.login('admin', 'Admin-Pass-1')).body.accessToken;
  // admin must change password first
  const ch = await ctx.http().post('/api/v1/auth/change-password').set(bearer(adminToken))
    .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' });
  adminToken = ch.body.accessToken;
  staffToken = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  const [u] = await ctx.t.db.select().from(users).where(eq(users.username, 'staff1'));
  creatorId = u!.id;
  for (const row of await ctx.t.db.select().from(genres)) g[row.code] = row.id;
});
afterAll(async () => {
  await ctx.close();
});

async function makeRack(code: string, sortOrder: number) {
  const res = await ctx.http().post('/api/v1/racks').set(bearer(adminToken)).send({ code, sortOrder });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function makeRow(rackId: string, rowNumber: number, capacity: number, genre: string | null, isOverflow = false) {
  const res = await ctx.http().post('/api/v1/rows').set(bearer(adminToken))
    .send({ rackId, rowNumber, capacity, genreId: genre ? g[genre] : null, isOverflow });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('allocation', () => {
  let rackA: string;
  let rowFic: string;
  let rowSci: string;
  let rowOverflow: string;

  beforeAll(async () => {
    rackA = await makeRack('A', 1);
    rowFic = await makeRow(rackA, 1, 30, 'FIC');
    rowSci = await makeRow(rackA, 2, 5, 'SCI');
    rowOverflow = await makeRow(rackA, 3, 4, null, true);
  });

  it('20 parallel creations get 20 distinct slots', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => createCopies('FIC', 1)));
    const slots = results.map((r) => `${r.copies[0]!.copy.rowId}:${r.copies[0]!.copy.slotNumber}`);
    expect(new Set(slots).size).toBe(20);
    expect(results.every((r) => r.copies[0]!.location?.startsWith('FIC-A01-'))).toBe(true);
    // filled from the first free slot upward, with no gaps
    const used = results.map((r) => r.copies[0]!.copy.slotNumber!).sort((a, b) => a - b);
    expect(used).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('formats location codes as GENRE-RACK+ROW-SLOT', async () => {
    const r = await createCopies('FIC', 1);
    expect(r.copies[0]!.location).toBe('FIC-A01-021');
  });

  it('quantity > 1 gets contiguous slots when available, skipping fragmented gaps', async () => {
    // SCI row (cap 5): occupy slot 1 and 3 manually, leaving gaps of 1 at 2, and a run of 2 at 4-5
    const titleId = await newTitle('SCI');
    for (const slot of [1, 3]) {
      await ctx.t.db.insert(copies).values({
        code: `BK${String(2_000_000 + slot)}`, titleId, condition: 'GOOD', sellingPriceMinor: 1, createdById: creatorId,
        rowId: rowSci, slotNumber: slot,
      });
    }
    const r = await createCopies('SCI', 2, true);
    expect(r.copies.map((c) => c.copy.slotNumber)).toEqual([4, 5]);
    expect(r.unplaced).toBe(0);
  });

  it('spills into the overflow row, using the copy’s own genre code, then goes unshelved', async () => {
    // SCI row now has slots 1,3,4,5 taken; slot 2 is free. Ask for 4 non-contiguously.
    const r = await createCopies('SCI', 4, false);
    expect(r.copies[0]!.location).toBe('SCI-A02-002');
    expect(r.copies.slice(1).map((c) => c.location)).toEqual(['SCI-A03-001', 'SCI-A03-002', 'SCI-A03-003']);
    expect(r.copies.every((c) => c.copy.rowId)).toBe(true);

    // overflow has 1 slot left; 3 more copies: 1 placed in overflow, 2 unshelved
    const more = await createCopies('SCI', 3, false);
    expect(more.unplaced).toBe(2);
    expect(more.copies.filter((c) => c.copy.rowId === null)).toHaveLength(2);
    expect(more.copies[0]!.location).toBe('SCI-A03-004');
  });

  it('never double-books a slot at database level', async () => {
    const dupes = await ctx.t.db.execute(sql`SELECT row_id, slot_number FROM copies WHERE row_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1`);
    expect(dupes.rows).toHaveLength(0);
  });

  it('lists unshelved copies and places them once space exists', async () => {
    const list = await ctx.http().get('/api/v1/shelves/unshelved').set(bearer(staffToken));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);

    expect((await ctx.http().post('/api/v1/shelves/place-unshelved').set(bearer(adminToken))).body).toEqual({ placed: 0, stillUnshelved: 2 });

    // add a new SCI row; both get placed and flagged for label reprint
    await makeRow(rackA, 4, 10, 'SCI');
    const placed = await ctx.http().post('/api/v1/shelves/place-unshelved').set(bearer(staffToken));
    expect(placed.status).toBe(201);
    expect(placed.body).toEqual({ placed: 2, stillUnshelved: 0 });
    const rows = await ctx.t.db.select().from(copies).where(sql`${copies.lastLocationCode} LIKE 'SCI-A04-%'`);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.labelNeedsPrint)).toBe(true);
  });
});

describe('shelf structure rules', () => {
  it('blocks capacity shrink and genre change while the row holds books', async () => {
    const rowId = (await ctx.t.db.select().from(shelfRows).where(eq(shelfRows.code, 'A01')))[0]!.id; // 21 FIC copies, slots 1..21
    const shrink = await ctx.http().patch(`/api/v1/rows/${rowId}`).set(bearer(adminToken)).send({ capacity: 10 });
    expect(shrink.status).toBe(409);
    expect(shrink.body.error.code).toBe('ROW_NOT_EMPTY');
    const regenre = await ctx.http().patch(`/api/v1/rows/${rowId}`).set(bearer(adminToken)).send({ genreId: g.SCI });
    expect(regenre.body.error.code).toBe('ROW_NOT_EMPTY');
    const deactivate = await ctx.http().patch(`/api/v1/rows/${rowId}`).set(bearer(adminToken)).send({ isActive: false });
    expect(deactivate.body.error.code).toBe('ROW_NOT_EMPTY');
    const grow = await ctx.http().patch(`/api/v1/rows/${rowId}`).set(bearer(adminToken)).send({ capacity: 50 });
    expect(grow.status).toBe(200);
    expect(grow.body.capacity).toBe(50);
  });

  it('allows shrinking down to the highest used slot, and reassigning an empty row', async () => {
    const rackId = await makeRack('Z', 9);
    const empty = await makeRow(rackId, 1, 20, 'ART');
    expect((await ctx.http().patch(`/api/v1/rows/${empty}`).set(bearer(adminToken)).send({ genreId: g.TRV, capacity: 5 })).status).toBe(200);
  });

  it('bulk-creates rows after the last row number', async () => {
    const rackId = await makeRack('Y', 10);
    const res = await ctx.http().post(`/api/v1/racks/${rackId}/rows/bulk`).set(bearer(adminToken)).send({ count: 3, capacity: 40, genreId: g.HIS });
    expect(res.status).toBe(201);
    expect(res.body.map((r: { code: string }) => r.code)).toEqual(['Y01', 'Y02', 'Y03']);
    const more = await ctx.http().post(`/api/v1/racks/${rackId}/rows/bulk`).set(bearer(adminToken)).send({ count: 2, capacity: 40 });
    expect(more.body.map((r: { code: string }) => r.code)).toEqual(['Y04', 'Y05']);
  });

  it('rejects duplicate racks and rows', async () => {
    expect((await ctx.http().post('/api/v1/racks').set(bearer(adminToken)).send({ code: 'a' })).status).toBe(409);
    const [rack] = await ctx.t.db.select().from(racks).where(eq(racks.code, 'A'));
    const dup = await ctx.http().post('/api/v1/rows').set(bearer(adminToken)).send({ rackId: rack!.id, rowNumber: 1, capacity: 5 });
    expect(dup.status).toBe(409);
  });
});

describe('map, slots, signs, permissions', () => {
  it('shows occupancy per row', async () => {
    const res = await ctx.http().get('/api/v1/shelves/map').set(bearer(staffToken));
    expect(res.status).toBe(200);
    const a = res.body.find((r: { code: string }) => r.code === 'A');
    const a01 = a.rows.find((r: { code: string }) => r.code === 'A01');
    expect(a01).toMatchObject({ used: 21, capacity: 50, genre: { code: 'FIC' }, reservedAtStall: 0 });
    expect(a01.percentFull).toBe(42);
  });

  it('returns slot-by-slot contents', async () => {
    const [row] = await ctx.t.db.select().from(shelfRows).where(eq(shelfRows.code, 'A02'));
    const res = await ctx.http().get(`/api/v1/shelves/rows/${row!.id}/slots`).set(bearer(adminToken));
    expect(res.body.slots).toHaveLength(5);
    expect(res.body.slots.every((x: { copy: unknown }) => x.copy)).toBe(true); // the SCI row is full after the spill test
  });

  it('renders row signs as a PDF', async () => {
    const res = await ctx.http().get('/api/v1/shelves/row-signs.pdf').set(bearer(adminToken)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('enforces permissions', async () => {
    const mgr = await ctx.userToken('mgr1', 'STALL_MANAGER');
    expect((await ctx.http().get('/api/v1/genres').set(bearer(staffToken))).status).toBe(200);
    expect((await ctx.http().post('/api/v1/genres').set(bearer(staffToken)).send({ name: 'X', code: 'XX' })).status).toBe(403);
    expect((await ctx.http().post('/api/v1/racks').set(bearer(staffToken)).send({ code: 'Q' })).status).toBe(403);
    expect((await ctx.http().get('/api/v1/shelves/map').set(bearer(mgr))).status).toBe(403);
    expect((await ctx.http().get('/api/v1/shelves/row-signs.pdf').set(bearer(staffToken))).status).toBe(403);
  });

  it('manages genres and keywords', async () => {
    const created = await ctx.http().post('/api/v1/genres').set(bearer(adminToken)).send({ name: 'Gardening', code: 'gdn', color: '#00AA00' });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('GDN');
    expect((await ctx.http().post('/api/v1/genres').set(bearer(adminToken)).send({ name: 'gardening', code: 'GRD' })).status).toBe(409);
    const kw = await ctx.http().put(`/api/v1/genres/${created.body.id}/keywords`).set(bearer(adminToken))
      .send({ keywords: [{ keyword: 'Garden', weight: 2 }, { keyword: 'garden' }, { keyword: 'plants' }] });
    expect(kw.body.keywords).toEqual([{ keyword: 'garden', weight: 1 }, { keyword: 'plants', weight: 1 }]);
    const off = await ctx.http().patch(`/api/v1/genres/${created.body.id}`).set(bearer(adminToken)).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    const list = await ctx.http().get('/api/v1/genres').set(bearer(staffToken));
    expect(list.body.find((x: { code: string }) => x.code === 'GDN')).toBeUndefined();
  });
});
