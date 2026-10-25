import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { externalLookupCache, genres } from '../src/db/schema/index.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const realFetch = globalThis.fetch;

interface Stub {
  olBooks?: string | number;
  olIsbn?: string | number;
  olWork?: string | number;
  gb?: string | number;
}
let calls: string[] = [];

/** Routes provider URLs to fixtures (or a status code). Anything else goes to the real fetch (local test servers). */
function stubProviders(s: Stub) {
  calls = [];
  const respond = (v: string | number | undefined) =>
    typeof v === 'number'
      ? new Response('error', { status: v })
      : new Response(v ?? '{}', { status: 200, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://openlibrary.org/api/books')) return (calls.push('ol-books'), respond(s.olBooks));
    if (url.startsWith('https://openlibrary.org/isbn/')) return (calls.push('ol-isbn'), respond(s.olIsbn));
    if (url.startsWith('https://openlibrary.org/works/')) return (calls.push('ol-work'), respond(s.olWork));
    if (url.startsWith('https://openlibrary.org/search.json')) return (calls.push('ol-search'), respond(fx('ol-search-god-of-small-things.json')));
    if (url.startsWith('https://www.googleapis.com/books/')) return (calls.push('gb'), respond(s.gb));
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    throw new Error(`Unexpected outbound request in test: ${url}`);
  });
}

let ctx: TestApp;
let staff: string;
let admin: string;
let manager: string;
let genreId: Record<string, string> = {};

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  manager = await ctx.userToken('mgr1', 'STALL_MANAGER');
  for (const g of await ctx.t.db.select().from(genres)) genreId[g.code] = g.id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await ctx.close();
});

const happy: Stub = {
  olBooks: fx('ol-books-9780143127550.json'),
  olIsbn: fx('ol-isbn-9780143127550.json'),
  olWork: fx('ol-work-OL17295077W.json'),
  gb: fx('gb-isbn-9780143127550.json'),
};

describe('GET /catalog/lookup', () => {
  it('merges Open Library and Google Books, suggests a genre, and caches', async () => {
    stubProviders(happy);
    const res = await ctx.http().get('/api/v1/catalog/lookup?isbn=978-0-14-312755-0').set(bearer(staff));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      inInventory: false, found: true, source: 'OPEN_LIBRARY', suggestedGenreId: genreId.MYS,
      metadata: { isbn13: '9780143127550', title: 'Everything I Never Told You', authors: ['Celeste Ng'], pageCount: 297, language: 'en' },
    });
    // description comes from Google Books (merge rule), cover from Open Library
    expect(res.body.metadata.summary).toMatch(/New York Times/);
    expect(res.body.metadata.coverUrl).toMatch(/covers\.openlibrary\.org/);
    expect(res.body.warnings).toBeUndefined();
    // the real subject list mentions mystery/suspense/detective, so MYS outscores FIC; the user confirms the genre
    expect(res.body.alternativeGenreIds).toContain(genreId.FIC);

    const before = calls.length;
    const again = await ctx.http().get('/api/v1/catalog/lookup?isbn=9780143127550').set(bearer(staff));
    expect(again.body.metadata.title).toBe('Everything I Never Told You');
    expect(calls.length).toBe(before); // served from external_lookup_cache
    const cached = await ctx.t.db.select().from(externalLookupCache);
    expect(cached.map((c) => c.provider).sort()).toEqual(['googlebooks', 'openlibrary']);
  });

  it('accepts an ISBN-10', async () => {
    stubProviders(happy);
    const res = await ctx.http().get('/api/v1/catalog/lookup?isbn=0143127551').set(bearer(staff));
    expect(res.body.metadata.isbn13).toBe('9780143127550');
  });

  it('works with Open Library alone when Google is down, and reports the failure', async () => {
    await ctx.t.db.delete(externalLookupCache);
    stubProviders({ ...happy, gb: 503 });
    const res = await ctx.http().get('/api/v1/catalog/lookup?isbn=9780143127550').set(bearer(staff));
    expect(res.body).toMatchObject({ found: true, source: 'OPEN_LIBRARY', warnings: ['EXTERNAL_LOOKUP_FAILED'] });
  });

  it('answers found:false (not an error) when both providers are down or have no match', async () => {
    await ctx.t.db.delete(externalLookupCache);
    stubProviders({ olBooks: 500, gb: 500 });
    const down = await ctx.http().get('/api/v1/catalog/lookup?isbn=9780306406157').set(bearer(staff));
    expect(down.status).toBe(200);
    expect(down.body).toEqual({ inInventory: false, found: false, warnings: ['EXTERNAL_LOOKUP_FAILED'] });
    // failures are not cached
    expect(await ctx.t.db.select().from(externalLookupCache)).toHaveLength(0);

    stubProviders({ olBooks: '{}', gb: fx('gb-empty.json') });
    const miss = await ctx.http().get('/api/v1/catalog/lookup?isbn=9780306406157').set(bearer(staff));
    expect(miss.body).toEqual({ inInventory: false, found: false });
    // known misses are cached (7 days)
    expect(await ctx.t.db.select().from(externalLookupCache)).toHaveLength(2);
  });

  it('rejects bad ISBNs and unauthorised roles', async () => {
    expect((await ctx.http().get('/api/v1/catalog/lookup?isbn=9780143127551').set(bearer(staff))).status).toBe(400);
    expect((await ctx.http().get('/api/v1/catalog/lookup?isbn=9780143127550').set(bearer(manager))).status).toBe(403);
  });
});

describe('GET /catalog/search and price suggestion', () => {
  it('searches local first, then Open Library', async () => {
    stubProviders(happy);
    const res = await ctx.http().get('/api/v1/catalog/search?q=god of small things').set(bearer(staff));
    expect(res.status).toBe(200);
    expect(res.body.hits[0]).toMatchObject({ source: 'OPEN_LIBRARY', title: 'The God of Small Things' });
  });

  it('suggests a rounded price from the condition percentage', async () => {
    const r = await ctx.http().get('/api/v1/catalog/price-suggestion?originalPriceMinor=39900&condition=GOOD').set(bearer(staff));
    expect(r.body).toEqual({ suggestedMinor: 14000, percent: 35, roundedToMinor: 1000 }); // 139.65 → ₹140
    const cheap = await ctx.http().get('/api/v1/catalog/price-suggestion?originalPriceMinor=3000&condition=POOR').set(bearer(staff));
    expect(cheap.body.suggestedMinor).toBe(1000); // never ₹0 for a priced book
    expect((await ctx.http().get('/api/v1/catalog/price-suggestion?originalPriceMinor=0&condition=GOOD').set(bearer(staff))).body.suggestedMinor).toBe(0);
  });
});
