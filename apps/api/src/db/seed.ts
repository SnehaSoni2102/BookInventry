import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from './client.js';
import { DEFAULT_SETTINGS, GENRES } from './seed-data.js';
import { genreKeywords, genres, racks, settings, shelfRows, users } from './schema/index.js';

export const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export interface SeedOptions {
  adminUsername?: string;
  adminPassword?: string;
  /** Creates the sample racks/rows. Never use in production. */
  sampleShelves: boolean;
}

/** Idempotent: safe to run any number of times. */
export async function seed(db: Db, opts: SeedOptions): Promise<void> {
  if (opts.adminUsername && opts.adminPassword) {
    const passwordHash = await hash(opts.adminPassword, ARGON2_OPTIONS);
    await db
      .insert(users)
      .values({
        username: opts.adminUsername,
        displayName: 'Administrator',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true,
      })
      .onConflictDoNothing({ target: users.username });
  }

  for (const [i, g] of GENRES.entries()) {
    await db
      .insert(genres)
      .values({ code: g.code, name: g.name, color: g.color, sortOrder: i + 1 })
      .onConflictDoNothing({ target: genres.code });
  }
  const genreRows = await db.select().from(genres);
  const byCode = new Map(genreRows.map((g) => [g.code, g]));
  for (const g of GENRES) {
    const row = byCode.get(g.code)!;
    if (g.keywords.length) {
      await db
        .insert(genreKeywords)
        .values(g.keywords.map((keyword) => ({ genreId: row.id, keyword })))
        .onConflictDoNothing();
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing({ target: settings.key });
  }

  if (opts.sampleShelves) await seedSampleShelves(db);
}

/** Racks A–C × 5 rows × 40 slots; rows follow genre sort order; C05 is the overflow row. */
async function seedSampleShelves(db: Db): Promise<void> {
  const ordered = (await db.select().from(genres).orderBy(genres.sortOrder)).filter((g) => g.isActive);
  let n = 0;
  for (const [ri, code] of ['A', 'B', 'C'].entries()) {
    await db.insert(racks).values({ code, name: `Rack ${code}`, sortOrder: ri + 1 }).onConflictDoNothing({ target: racks.code });
    const [rack] = await db.select().from(racks).where(eq(racks.code, code));
    for (let rowNumber = 1; rowNumber <= 5; rowNumber++) {
      const overflow = code === 'C' && rowNumber === 5;
      const genre = overflow ? undefined : ordered[n++];
      await db
        .insert(shelfRows)
        .values({
          rackId: rack!.id,
          rowNumber,
          code: `${code}${String(rowNumber).padStart(2, '0')}`,
          capacity: 40,
          genreId: genre?.id ?? null,
          isOverflow: overflow,
        })
        .onConflictDoNothing({ target: shelfRows.code });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const production = process.env.NODE_ENV === 'production';
  const adminUsername = process.env.SEED_ADMIN_USERNAME || (production ? undefined : 'admin');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (production ? undefined : 'ChangeMe123!');
  if (production && (!adminUsername || !adminPassword)) {
    throw new Error('SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD are required in production');
  }
  const { db, pool } = createDb(url, 2);
  seed(db, { adminUsername, adminPassword, sampleShelves: !production })
    .then(() => console.log('seed complete'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => pool.end());
}
