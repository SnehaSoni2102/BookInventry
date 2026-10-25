/**
 * Starts a throw-away API on a fresh, migrated, seeded database for the Playwright suite.
 * External book lookups go to the mock provider server (e2e/mock-providers.mjs), never the internet.
 */
import pg from 'pg';

const adminUrl = process.env.E2E_ADMIN_URL ?? 'postgres://postgres@localhost:5433/postgres';
const dbName = process.env.E2E_DB_NAME ?? 'bookstall_e2e';
const port = Number(process.env.E2E_API_PORT ?? 3100);
const web = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:4173';

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

const u = new URL(adminUrl);
u.pathname = `/${dbName}`;
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_URL: u.toString(),
  JOBS_MODE: 'memory',
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  PUBLIC_APP_URL: web,
  CORS_ORIGINS: web,
  EXTERNAL_MIN_INTERVAL_MS: '0',
  LOCAL_STORAGE_DIR: `./.data/e2e-storage`,
  OPENLIBRARY_BASE_URL: process.env.OPENLIBRARY_BASE_URL ?? 'http://127.0.0.1:4010/ol',
  GOOGLE_BOOKS_BASE_URL: process.env.GOOGLE_BOOKS_BASE_URL ?? 'http://127.0.0.1:4010/gb',
});

const { runMigrations } = await import('../src/db/migrate.js');
const { createDb } = await import('../src/db/client.js');
const { seed } = await import('../src/db/seed.js');
await runMigrations(process.env.DATABASE_URL!);
const { db, pool } = createDb(process.env.DATABASE_URL!, 2);
await seed(db, { adminUsername: 'admin', adminPassword: 'Admin-Pass-1', sampleShelves: true });
await pool.end();

await import('reflect-metadata');
const { createApp } = await import('../src/app.js');
const app = await createApp();
const { JobsService } = await import('../src/modules/jobs/jobs.service.js');
const jobs = app.get(JobsService);
let draining = false; // stands in for the worker process
setInterval(() => {
  if (draining) return;
  draining = true;
  void jobs.drain().finally(() => { draining = false; });
}, 250);
await app.listen(port, '127.0.0.1');
console.log(`e2e API ready on :${port}`);
