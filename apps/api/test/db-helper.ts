import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

/**
 * Uses TEST_DATABASE_URL (an admin connection to any Postgres) when set, otherwise starts a
 * Postgres Testcontainer. Each test file then gets its own freshly migrated database.
 */
export async function startTestDatabase(): Promise<{ adminUrl: string; stop: () => Promise<void> }> {
  if (process.env.TEST_DATABASE_URL) {
    return { adminUrl: process.env.TEST_DATABASE_URL, stop: async () => {} };
  }
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  return { adminUrl: container.getConnectionUri(), stop: async () => void (await container.stop()) };
}

export interface TestDb {
  db: Db;
  url: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const adminUrl = process.env.TEST_ADMIN_URL;
  if (!adminUrl) throw new Error('TEST_ADMIN_URL not set (global setup did not run)');
  const name = `bookstall_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  await runMigrations(url);
  const { db, pool } = createDb(url, 20);

  return {
    db,
    url,
    pool,
    drop: async () => {
      await pool.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
