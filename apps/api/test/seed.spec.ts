import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count } from 'drizzle-orm';
import { genreKeywords, genres, racks, settings, shelfRows, users } from '../src/db/schema/index.js';
import { GENRES } from '../src/db/seed-data.js';
import { seed } from '../src/db/seed.js';
import { createTestDb, type TestDb } from './db-helper.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

async function counts() {
  const one = async (tbl: Parameters<typeof t.db.select>[0] extends never ? never : any) =>
    Number((await t.db.select({ n: count() }).from(tbl))[0]!.n);
  return {
    users: await one(users), genres: await one(genres), keywords: await one(genreKeywords),
    settings: await one(settings), racks: await one(racks), rows: await one(shelfRows),
  };
}

describe('seed', () => {
  it('is idempotent', async () => {
    const opts = { adminUsername: 'admin', adminPassword: 'ChangeMe123!', sampleShelves: true };
    await seed(t.db, opts);
    const first = await counts();
    await seed(t.db, opts);
    expect(await counts()).toEqual(first);
    expect(first.users).toBe(1);
    expect(first.genres).toBe(GENRES.length);
    expect(first.racks).toBe(3);
    expect(first.rows).toBe(15);
  });

  it('stores an argon2id hash, never the plaintext', async () => {
    const [u] = await t.db.select().from(users);
    expect(u!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u!.mustChangePassword).toBe(true);
  });

  it('marks exactly one overflow row (C05)', async () => {
    const rows = await t.db.select().from(shelfRows);
    const overflow = rows.filter((r) => r.isOverflow);
    expect(overflow.map((r) => r.code)).toEqual(['C05']);
  });
});
