import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from '@node-rs/argon2';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { JobsService } from '../src/modules/jobs/jobs.service.js';
import { EventBus } from '../src/common/events/event-bus.js';
import { users } from '../src/db/schema/index.js';
import { seed } from '../src/db/seed.js';
import { createTestDb, type TestDb } from './db-helper.js';
import type { Role } from '@bookstall/shared';

export interface TestApp {
  app: NestExpressApplication;
  t: TestDb;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
  /** Creates a user directly in the DB (no must-change-password) and returns a bearer token. */
  userToken: (username: string, role: Role, opts?: { mustChange?: boolean }) => Promise<string>;
  jobs: JobsService;
  events: EventBus;
  storageDir: string;
  login: (username: string, password: string, client?: 'web' | 'mobile') => request.Test;
}

export async function createTestApp(opts: { rateLimit?: boolean; sampleShelves?: boolean } = {}): Promise<TestApp> {
  const t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  process.env.LOG_LEVEL = 'silent';
  const storageDir = mkdtempSync(path.join(os.tmpdir(), 'bookstall-test-'));
  process.env.JOBS_MODE = 'memory';
  process.env.EXTERNAL_MIN_INTERVAL_MS = '0';
  process.env.ALLOW_PRIVATE_FETCH = 'true';
  process.env.LOCAL_STORAGE_DIR = storageDir;
  process.env.RATE_LIMIT_ENABLED = String(opts.rateLimit ?? false);
  await seed(t.db, { adminUsername: 'admin', adminPassword: 'Admin-Pass-1', sampleShelves: opts.sampleShelves ?? true });
  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  await app.listen(0, '127.0.0.1'); // listening server: supertest shares it across concurrent requests
  const http = () => request(app.getHttpServer());
  const login = (username: string, password: string, client: 'web' | 'mobile' = 'mobile') =>
    http().post('/api/v1/auth/login').send({ username, password, client });
  return {
    app,
    t,
    storageDir,
    jobs: app.get(JobsService),
    events: app.get(EventBus),
    http,
    login,
    close: async () => {
      await app.close();
      await t.drop();
    },
    userToken: async (username, role, o = {}) => {
      await t.db
        .insert(users)
        .values({
          username,
          displayName: username,
          role,
          passwordHash: await hash('Test-Pass-123'),
          mustChangePassword: o.mustChange ?? false,
        })
        .onConflictDoNothing();
      const res = await login(username, 'Test-Pass-123');
      return res.body.accessToken as string;
    },
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
