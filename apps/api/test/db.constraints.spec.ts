import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  bookTitles, copies, genres, racks, shelfRows, stallAssignments, stallMovements, stalls, users,
} from '../src/db/schema/index.js';
import { seed } from '../src/db/seed.js';
import { createTestDb, type TestDb } from './db-helper.js';

let t: TestDb;
let userId: string;
let userId2: string;
let titleId: string;
let rowId: string;
let stallId: string;
let stall2Id: string;
let n = 0;

async function code(): Promise<string> {
  const r = await t.db.execute(sql`SELECT 'BK' || lpad(nextval('copy_code_seq')::text, 7, '0') AS c`);
  return String(r.rows[0]!.c);
}

async function insertCopy(over: Record<string, unknown> = {}) {
  return t.db
    .insert(copies)
    .values({
      code: await code(),
      titleId,
      condition: 'GOOD',
      sellingPriceMinor: 10000,
      createdById: userId,
      ...over,
    } as typeof copies.$inferInsert)
    .returning();
}

/** Drizzle wraps driver errors; the Postgres message lives on `cause`. */
async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { message: string; cause?: { message?: string } };
    expect(`${err.message} ${err.cause?.message ?? ''}`).toMatch(pattern);
    return;
  }
  throw new Error('expected the statement to be rejected');
}

beforeAll(async () => {
  t = await createTestDb();
  await seed(t.db, { adminUsername: 'admin', adminPassword: 'ChangeMe123!', sampleShelves: false });
  const [u] = await t.db.select().from(users).where(eq(users.username, 'admin'));
  userId = u!.id;
  const [u2] = await t.db
    .insert(users)
    .values({ username: 'mgr1', displayName: 'Mgr', passwordHash: 'x', role: 'STALL_MANAGER' })
    .returning();
  userId2 = u2!.id;
  const [g] = await t.db.select().from(genres).where(eq(genres.code, 'FIC'));
  const [title] = await t.db
    .insert(bookTitles)
    .values({ title: 'T', titleSort: 't', searchText: 't', genreId: g!.id, source: 'MANUAL' })
    .returning();
  titleId = title!.id;
  const [rack] = await t.db.insert(racks).values({ code: 'A', sortOrder: 1 }).returning();
  const [row] = await t.db
    .insert(shelfRows)
    .values({ rackId: rack!.id, rowNumber: 1, code: 'A01', capacity: 10, genreId: g!.id })
    .returning();
  rowId = row!.id;
  const [s1] = await t.db.insert(stalls).values({ name: 'Mela' }).returning();
  const [s2] = await t.db.insert(stalls).values({ name: 'Fest' }).returning();
  stallId = s1!.id;
  stall2Id = s2!.id;
});

afterAll(async () => {
  await t.drop();
});

describe('copies constraints', () => {
  it('rejects two copies in the same (row, slot)', async () => {
    const slot = ++n;
    await insertCopy({ rowId, slotNumber: slot });
    await expectDbError(insertCopy({ rowId, slotNumber: slot }), /copies_unique_slot|unique/i);
  });

  it('allows many unshelved copies (NULL slots do not conflict)', async () => {
    await insertCopy();
    await insertCopy();
  });

  it('requires row and slot to be set together', async () => {
    await expectDbError(insertCopy({ rowId }), /copies_slot_pair/);
  });

  it('AT_STALL requires current_stall_id and vice versa', async () => {
    await expectDbError(insertCopy({ status: 'AT_STALL' }), /copies_stall_status/);
    await expectDbError(insertCopy({ currentStallId: stallId }), /copies_stall_status/);
    await insertCopy({ status: 'AT_STALL', currentStallId: stallId });
  });

  it('a SOLD copy may not keep a shelf slot', async () => {
    await expectDbError(
      insertCopy({ status: 'SOLD', soldAt: new Date(), rowId, slotNumber: 9 }),
      /copies_slot_released/,
    );
    await insertCopy({ status: 'SOLD', soldAt: new Date() });
  });

  it('SOLD requires sold_at and WRITTEN_OFF requires a reason', async () => {
    await expectDbError(insertCopy({ status: 'SOLD' }), /copies_sold_at/);
    await expectDbError(insertCopy({ status: 'WRITTEN_OFF' }), /copies_writeoff/);
    await insertCopy({ status: 'WRITTEN_OFF', writeoffReason: 'DAMAGED' });
  });

  it('an AT_STALL copy keeps its slot (reserved)', async () => {
    await insertCopy({ status: 'AT_STALL', currentStallId: stallId, rowId, slotNumber: 8 });
  });

  it('rejects negative prices and malformed codes', async () => {
    await expectDbError(insertCopy({ sellingPriceMinor: -1 }), /copies_selling_price_nonneg/);
    await expectDbError(insertCopy({ code: 'bad' }), /copies_code_format/);
  });
});

describe('movements and assignments', () => {
  it('rejects a second OPEN movement for the same copy', async () => {
    const [c] = await insertCopy({ status: 'AT_STALL', currentStallId: stallId });
    const base = { copyId: c!.id, stallId, batchId: crypto.randomUUID(), checkedOutById: userId };
    await t.db.insert(stallMovements).values(base);
    await expectDbError(
      t.db.insert(stallMovements).values({ ...base, batchId: crypto.randomUUID() }),
      /stall_movements_one_open_per_copy/,
    );
    // a closed movement does not block a new open one
    await t.db
      .update(stallMovements)
      .set({ outcome: 'RETURNED', checkedInAt: new Date(), checkedInById: userId })
      .where(eq(stallMovements.copyId, c!.id));
    await t.db.insert(stallMovements).values({ ...base, batchId: crypto.randomUUID() });
  });

  it('RETURNED must have checked_in_at', async () => {
    const [c] = await insertCopy({ status: 'AT_STALL', currentStallId: stallId });
    await expectDbError(
      t.db.insert(stallMovements).values({
        copyId: c!.id, stallId, batchId: crypto.randomUUID(), checkedOutById: userId, outcome: 'RETURNED',
      }),
      /stall_movements_returned_checkin/,
    );
  });

  it('a user can have only one active stall assignment', async () => {
    await t.db.insert(stallAssignments).values({ stallId, userId: userId2 });
    await expectDbError(
      t.db.insert(stallAssignments).values({ stallId: stall2Id, userId: userId2 }),
      /stall_assignments_one_active_per_user/,
    );
    await t.db.update(stallAssignments).set({ unassignedAt: new Date() }).where(eq(stallAssignments.userId, userId2));
    await t.db.insert(stallAssignments).values({ stallId: stall2Id, userId: userId2 });
  });
});

describe('other constraints', () => {
  it('stall names are unique among live stalls (case-insensitive)', async () => {
    await expectDbError(t.db.insert(stalls).values({ name: 'MELA' }), /stalls_name_live_uq/);
    await t.db.update(stalls).set({ deletedAt: new Date() }).where(eq(stalls.id, stallId));
    await t.db.insert(stalls).values({ name: 'mela' });
  });

  it('validates usernames, ISBNs and genre codes', async () => {
    await expectDbError(
      t.db.insert(users).values({ username: 'Bad Name', displayName: 'x', passwordHash: 'x', role: 'ADMIN' }),
      /users_username_format/,
    );
    await expectDbError(
      t.db.insert(bookTitles).values({
        title: 'x', titleSort: 'x', searchText: 'x', genreId: (await t.db.select().from(genres).limit(1))[0]!.id,
        source: 'MANUAL', isbn13: '1234567890123',
      }),
      /book_titles_isbn13_format/,
    );
    await expectDbError(
      t.db.insert(genres).values({ name: 'Zed', code: 'z', sortOrder: 99 }),
      /genres_code_format/,
    );
  });

  it('pg_trgm similarity works on search_text', async () => {
    const r = await t.db.execute(sql`SELECT similarity('god of small things', 'god of small thing') AS s`);
    expect(Number(r.rows[0]!.s)).toBeGreaterThan(0.5);
  });
});
