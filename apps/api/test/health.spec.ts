import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db-helper.js';

let t: TestDb;
let app: NestExpressApplication;

beforeAll(async () => {
  t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  process.env.LOG_LEVEL = 'silent';
  const { createApp } = await import('../src/app.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await app.close();
  await t.drop();
});

describe('health', () => {
  it('live', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('ready once migrations are applied', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
  });

  it('sends security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
