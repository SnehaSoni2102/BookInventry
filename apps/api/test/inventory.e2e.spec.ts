import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { isbn13Checksum } from '@bookstall/shared';
import { copies, genres, stallAssignments, stalls, users } from '../src/db/schema/index.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
let admin: string;
let staff: string;
let mgrA: string;
let mgrB: string;
let mgrNone: string;
let stallA: string;
let stallB: string;
const g: Record<string, string> = {};
const T: Record<string, { id: string; copies: Array<{ id: string; code: string }> }> = {};

const isbn = (n: number) => {
  const body = `978${String(n).padStart(9, '0')}`;
  return body + isbn13Checksum(body);
};

async function addBook(key: string, title: string, authors: string[], genre: string, sets: Array<{ qty: number; condition: string; price: number; mrp?: number }>, extra: Record<string, unknown> = {}) {
  let titleId: string | undefined;
  const made: Array<{ id: string; code: string }> = [];
  for (const s of sets) {
    const res = await ctx.http().post('/api/v1/copies').set(bearer(staff)).send({
      clientRef: crypto.randomUUID(),
      quantity: s.qty,
      copy: { condition: s.condition, sellingPriceMinor: s.price, ...(s.mrp ? { originalPriceMinor: s.mrp } : {}) },
      ...(titleId ? { titleId } : { title: { title, authors, genreId: g[genre], ...extra } }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    titleId = res.body.title.id;
    made.push(...res.body.copies);
  }
  T[key] = { id: titleId!, copies: made };
}

const titles = (token: string, qs = '') => ctx.http().get(`/api/v1/titles?${qs}`).set(bearer(token));
const copiesList = (token: string, qs = '') => ctx.http().get(`/api/v1/copies?${qs}`).set(bearer(token));
const names = (res: { body: { items: Array<{ title: string }> } }) => res.body.items.map((i) => i.title);

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  mgrA = await ctx.userToken('mgr.a', 'STALL_MANAGER');
  mgrB = await ctx.userToken('mgr.b', 'STALL_MANAGER');
  mgrNone = await ctx.userToken('mgr.none', 'STALL_MANAGER');
  for (const row of await ctx.t.db.select().from(genres)) g[row.code] = row.id;

  await addBook('god', 'The God of Small Things', ['Arundhati Roy'], 'FIC',
    [{ qty: 2, condition: 'GOOD', price: 12000, mrp: 39900 }, { qty: 1, condition: 'FAIR', price: 8000, mrp: 39900 }], { isbn13: isbn(1001) });
  await addBook('time', 'A Brief History of Time', ['Stephen Hawking'], 'SCI', [{ qty: 1, condition: 'NEW', price: 30000 }], { isbn13: isbn(1002) });
  await addBook('zen', 'Zen and the Art of Motorcycle Maintenance', ['Robert Pirsig'], 'PHI', [{ qty: 1, condition: 'GOOD', price: 15000 }]);
  await addBook('cafe', 'Éclair: Café Récipes', ['José Núñez'], 'CKG', [{ qty: 1, condition: 'VERY_GOOD', price: 20000 }]);
  await addBook('hindi', 'हिन्दी की किताब', ['प्रेमचंद'], 'HIN', [{ qty: 1, condition: 'GOOD', price: 5000 }], { language: 'hi' });
  for (let i = 1; i <= 30; i++) {
    await addBook(`bulk${i}`, `Bulk Book ${String(i).padStart(2, '0')}`, ['Bulk Author'], 'ROM', [{ qty: 1, condition: 'GOOD', price: 1000 * i }]);
  }

  // Two ACTIVE stalls: A has the manager "mgr.a"; one GOOD copy of "God" and the Zen copy are out there.
  const [sa] = await ctx.t.db.insert(stalls).values({ name: 'Stall A', status: 'ACTIVE' }).returning();
  const [sb] = await ctx.t.db.insert(stalls).values({ name: 'Stall B', status: 'ACTIVE' }).returning();
  stallA = sa!.id;
  stallB = sb!.id;
  const uid = async (name: string) => (await ctx.t.db.select().from(users).where(eq(users.username, name)))[0]!.id;
  await ctx.t.db.insert(stallAssignments).values([{ stallId: stallA, userId: await uid('mgr.a') }, { stallId: stallB, userId: await uid('mgr.b') }]);
  const out = async (id: string, stall: string) => ctx.t.db.update(copies).set({ status: 'AT_STALL', currentStallId: stall }).where(eq(copies.id, id));
  await out(T.god!.copies[0]!.id, stallA);
  await out(T.zen!.copies[0]!.id, stallA);
  await out(T.time!.copies[0]!.id, stallB);
});
afterAll(async () => {
  await ctx.close();
});

describe('GET /titles — scope and status', () => {
  it('defaults to what is available at central', async () => {
    const res = await titles(staff, 'pageSize=100');
    expect(res.status).toBe(200);
    expect(names(res)).not.toContain('Zen and the Art of Motorcycle Maintenance'); // out at Stall A
    expect(names(res)).not.toContain('A Brief History of Time'); // out at Stall B
    const god = res.body.items.find((i: { title: string }) => i.title === 'The God of Small Things');
    expect(god).toMatchObject({
      availableCount: 2, minPriceMinor: 8000, maxPriceMinor: 12000, isbn13: isbn(1001),
      authors: ['Arundhati Roy'], genre: { code: 'FIC' }, coverThumbUrl: null,
    });
    expect(god.conditions.sort()).toEqual(['FAIR', 'GOOD']);
  });

  it('can include copies at stalls', async () => {
    const atStalls = await titles(staff, 'status=atStalls');
    expect(names(atStalls).sort()).toEqual(['A Brief History of Time', 'The God of Small Things', 'Zen and the Art of Motorcycle Maintenance']);
    const all = await titles(admin, 'status=all&q=god');
    expect(all.body.items[0]).toMatchObject({ title: 'The God of Small Things', availableCount: 3 });
    const forStall = await titles(staff, `stallId=${stallB}`);
    expect(names(forStall)).toEqual(['A Brief History of Time']);
  });

  it('pins stall managers to their own stall, whatever they ask for', async () => {
    const res = await titles(mgrA, `status=available&pageSize=100`);
    expect(names(res).sort()).toEqual(['The God of Small Things', 'Zen and the Art of Motorcycle Maintenance']);
    expect(res.body.items.find((i: { title: string }) => i.title === 'The God of Small Things').availableCount).toBe(1);
    // trying to peek at central stock or another stall changes nothing
    expect(names(await titles(mgrA, 'status=all'))).toHaveLength(2);
    expect(names(await titles(mgrA, `stallId=${stallB}`))).toHaveLength(2);
    expect(names(await titles(mgrB))).toEqual(['A Brief History of Time']);
  });

  it('gives a manager with no active stall an empty list and a flag', async () => {
    const res = await titles(mgrNone);
    expect(res.body).toMatchObject({ items: [], total: 0, noActiveStall: true });
    expect((await copiesList(mgrNone)).body.noActiveStall).toBe(true);
  });

  it('requires authentication', async () => {
    expect((await ctx.http().get('/api/v1/titles')).status).toBe(401);
    expect((await ctx.http().get('/api/v1/copies')).status).toBe(401);
  });
});

describe('GET /titles — search', () => {
  it('finds by partial title, author, and a few words in any order', async () => {
    expect(names(await titles(staff, 'q=small things'))[0]).toBe('The God of Small Things');
    expect(names(await titles(staff, 'q=roy'))).toEqual(['The God of Small Things']);
    expect(names(await titles(staff, 'q=roy small'))).toEqual(['The God of Small Things']);
    expect(names(await titles(staff, 'q=motorcycle&status=all'))).toEqual(['Zen and the Art of Motorcycle Maintenance']);
  });

  it('is fuzzy (typos) and ignores case, punctuation and accents', async () => {
    expect(names(await titles(staff, 'q=GOD OF SMAL THINGS'))[0]).toBe('The God of Small Things');
    expect(names(await titles(staff, 'q=cafe recipes'))).toEqual(['Éclair: Café Récipes']);
    expect(names(await titles(staff, 'q=jose nunez'))).toEqual(['Éclair: Café Récipes']);
    expect(names(await titles(staff, 'q=eclair'))).toEqual(['Éclair: Café Récipes']);
    expect(names(await titles(staff, 'q=किताब'))).toEqual(['हिन्दी की किताब']);
    expect(names(await titles(staff, 'q=quantum%20chromodynamics'))).toEqual([]);
  });

  it('treats LIKE wildcards in the query as plain text', async () => {
    expect(names(await titles(staff, 'q=%25'))).toEqual([]);
    expect(names(await titles(staff, 'q=_'))).toEqual([]);
    // punctuation is a word separator, not a wildcard: "bulk%book" is just "bulk book"
    expect(names(await titles(staff, 'q=bulk%25zzz'))).toEqual([]);
  });

  it('short-circuits a pasted ISBN or copy code to an exact match', async () => {
    const byIsbn = await titles(staff, `q=${isbn(1001).replace(/^(\d{3})(\d)/, '$1-$2')}`);
    expect(byIsbn.body.items).toHaveLength(1);
    expect(byIsbn.body.exactMatch).toEqual({ type: 'isbn', isbn13: isbn(1001), titleId: T.god!.id });

    const code = T.zen!.copies[0]!.code;
    const byCode = await titles(staff, `q=${code}&status=all`);
    expect(byCode.body.exactMatch).toEqual({ type: 'copy', code, copyId: T.zen!.copies[0]!.id });
    expect(names(byCode)).toEqual(['Zen and the Art of Motorcycle Maintenance']);
    // a label URL works too
    expect((await titles(staff, `q=${encodeURIComponent(`https://x.org/b/${code}`)}&status=all`)).body.exactMatch.code).toBe(code);
  });

  it('does not leak other stalls through an exact code match for a manager', async () => {
    const res = await titles(mgrA, `q=${T.time!.copies[0]!.code}`);
    expect(res.body.items).toEqual([]);
    expect(res.body.exactMatch).toBeUndefined();
  });
});

describe('GET /titles — filters, sort, pagination', () => {
  it('filters by genre, condition (repeated or comma-separated) and price range', async () => {
    expect(names(await titles(staff, `genreId=${g.SCI}&status=all`))).toEqual(['A Brief History of Time']);
    expect(names(await titles(staff, `genreId=${g.SCI},${g.PHI}&status=all`)).sort()).toEqual(['A Brief History of Time', 'Zen and the Art of Motorcycle Maintenance']);
    expect(names(await titles(staff, `condition=NEW&condition=VERY_GOOD&status=all`)).sort()).toEqual(['A Brief History of Time', 'Éclair: Café Récipes']);
    expect(names(await titles(staff, 'condition=NEW,VERY_GOOD&status=all')).sort()).toEqual(['A Brief History of Time', 'Éclair: Café Récipes']);
    const pricey = names(await titles(staff, 'minPrice=18000&status=all&pageSize=100'));
    expect(pricey).toEqual(expect.arrayContaining(['A Brief History of Time', 'Éclair: Café Récipes']));
    expect(pricey).not.toContain('The God of Small Things');
    expect(pricey).not.toContain('Zen and the Art of Motorcycle Maintenance');
    expect(names(await titles(staff, 'q=small&maxPrice=9000'))).toEqual(['The God of Small Things']);
    // a filter narrows the aggregates too: only FAIR (₹80) copies count
    const fair = await titles(staff, 'q=small&condition=FAIR');
    expect(fair.body.items[0]).toMatchObject({ availableCount: 1, minPriceMinor: 8000, maxPriceMinor: 8000 });
  });

  it('rejects bad filter values', async () => {
    expect((await titles(staff, 'condition=MINT')).status).toBe(400);
    expect((await titles(staff, 'genreId=nope')).status).toBe(400);
    expect((await titles(staff, 'status=bogus')).status).toBe(400);
    expect((await titles(staff, 'sort=price&order=sideways')).status).toBe(400);
    expect((await titles(staff, 'pageSize=101')).status).toBe(400);
    expect((await titles(staff, 'page=0')).status).toBe(400);
  });

  it('sorts by title, author, price, newest and quantity in both directions', async () => {
    const q = (s: string) => titles(staff, `${s}&status=all&pageSize=100`);
    const az = names(await q('sort=title'));
    expect(az.indexOf('A Brief History of Time')).toBeLessThan(az.indexOf('The God of Small Things')); // "The" ignored → "God…"
    expect(names(await q('sort=title&order=desc'))[0]).toBe(az.at(-1));
    const byAuthor = names(await q('sort=author'));
    expect(byAuthor.indexOf('A Brief History of Time')).toBeLessThan(byAuthor.indexOf('The God of Small Things')); // hawking < roy
  });

  it('price sort orders by the cheapest matching copy', async () => {
    const asc = await titles(staff, 'sort=price&status=all&pageSize=100');
    const mins = asc.body.items.map((i: { minPriceMinor: number }) => i.minPriceMinor);
    expect(mins).toEqual([...mins].sort((a: number, b: number) => a - b));
    const desc = await titles(staff, 'sort=price&order=desc&status=all&pageSize=100');
    const maxs = desc.body.items.map((i: { minPriceMinor: number }) => i.minPriceMinor);
    expect(maxs).toEqual([...maxs].sort((a: number, b: number) => b - a));
  });

  it('sorts newest first and by quantity', async () => {
    expect(names(await titles(staff, 'sort=newest&pageSize=3'))[0]).toBe('Bulk Book 30');
    expect(names(await titles(staff, 'sort=quantity&status=all'))[0]).toBe('The God of Small Things');
  });

  it('paginates with a stable total', async () => {
    const p1 = await titles(staff, 'pageSize=10&page=1');
    const p2 = await titles(staff, 'pageSize=10&page=2');
    const p4 = await titles(staff, 'pageSize=10&page=4');
    expect(p1.body).toMatchObject({ page: 1, pageSize: 10, total: 33 }); // 30 bulk + God + Café + Hindi (Zen & Time are out)
    expect(p4.body.total).toBe(33);
    expect(p1.body.items).toHaveLength(10);
    expect(p2.body.items).toHaveLength(10);
    expect(p4.body.items).toHaveLength(3);
    const ids = [...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(20);
  });
});

describe('GET /copies', () => {
  it('lists physical copies with location, title info and the stall name', async () => {
    const res = await copiesList(admin, 'status=all&q=small&sort=code');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const atStall = res.body.items.find((c: { status: string }) => c.status === 'AT_STALL');
    expect(atStall).toMatchObject({ title: 'The God of Small Things', stall: { name: 'Stall A' }, condition: 'GOOD', sellingPriceMinor: 12000 });
    expect(atStall.locationCode).toMatch(/^FIC-A01-\d{3}$/); // reserved while out
    expect(res.body.items.find((c: { status: string }) => c.status === 'IN_STOCK').stall).toBeNull();
  });

  it('finds a copy by code and returns exactMatch', async () => {
    const code = T.cafe!.copies[0]!.code;
    const res = await copiesList(staff, `q=${code.toLowerCase()}`);
    expect(res.body.items.map((c: { code: string }) => c.code)).toEqual([code]);
    expect(res.body.exactMatch).toMatchObject({ type: 'copy', code });
  });

  it('sorts by location, price and code', async () => {
    const byLoc = await copiesList(staff, 'sort=location&pageSize=100');
    // order is rack → row → slot (the genre prefix is ignored: overflow books carry their own genre)
    const positions = byLoc.body.items.map((c: { locationCode: string }) => c.locationCode.split('-').slice(1).join('-'));
    expect(positions).toEqual([...positions].sort());
    expect(byLoc.body.items.at(-1).locationCode).toMatch(/-C05-/); // overflow row is in the last rack
    const byPrice = await copiesList(staff, 'sort=price&order=desc&pageSize=5');
    const prices = byPrice.body.items.map((c: { sellingPriceMinor: number }) => c.sellingPriceMinor);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => b - a));
  });

  it('filters unshelved and label-pending copies (staff and admin only)', async () => {
    const pending = await copiesList(staff, 'labelPending=true');
    expect(pending.body.total).toBe(34); // 37 copies, 3 are out at stalls
    await ctx.t.db.update(copies).set({ labelNeedsPrint: false }).where(inArray(copies.id, T.god!.copies.map((c) => c.id)));
    expect((await copiesList(staff, 'labelPending=true')).body.total).toBe(32);

    await ctx.t.db.update(copies).set({ rowId: null, slotNumber: null }).where(eq(copies.id, T.cafe!.copies[0]!.id));
    const unshelved = await copiesList(staff, 'unshelved=true');
    expect(unshelved.body.items.map((c: { code: string }) => c.code)).toEqual([T.cafe!.copies[0]!.code]);
    expect(unshelved.body.items[0].locationCode).toBeNull();
    // managers cannot use these staff-only filters to widen their view
    expect((await copiesList(mgrA, 'unshelved=true')).body.total).toBe(2);
  });

  it("scopes a manager to their stall's copies only", async () => {
    const res = await copiesList(mgrA, 'pageSize=100&status=all');
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((c: { status: string; currentStallId: string }) => c.status === 'AT_STALL' && c.currentStallId === stallA)).toBe(true);
    expect((await copiesList(mgrA, `q=${T.cafe!.copies[0]!.code}`)).body.items).toEqual([]);
  });

  it("limits the title detail's copy groups to the manager's stall", async () => {
    const res = await ctx.http().get(`/api/v1/titles/${T.god!.id}`).set(bearer(mgrA));
    expect(res.status).toBe(200);
    expect(res.body.copyGroups).toHaveLength(1);
    expect(res.body.copyGroups[0]).toMatchObject({ quantity: 1, status: 'AT_STALL', stall: { name: 'Stall A' } });
    const staffView = await ctx.http().get(`/api/v1/titles/${T.god!.id}`).set(bearer(staff));
    expect(staffView.body.copyGroups.map((x: { status: string; quantity: number }) => `${x.status}:${x.quantity}`).sort()).toEqual(['AT_STALL:1', 'IN_STOCK:1', 'IN_STOCK:1']);
    // Stall B's manager has no copies of this title → not found
    expect((await ctx.http().get(`/api/v1/titles/${T.god!.id}`).set(bearer(mgrB))).status).toBe(404);
  });
});
