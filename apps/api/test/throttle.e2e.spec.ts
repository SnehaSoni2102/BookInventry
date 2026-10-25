import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app-helper.js';

let ctx: TestApp;
beforeAll(async () => {
  ctx = await createTestApp({ rateLimit: true });
});
afterAll(async () => {
  await ctx.close();
});

describe('login throttling', () => {
  it('allows 5 attempts per minute per IP+username, then 429', async () => {
    for (let i = 0; i < 5; i++) expect((await ctx.login('admin', 'wrong-wrong')).status).toBe(401);
    const sixth = await ctx.login('admin', 'wrong-wrong');
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
    // a different username has its own budget
    expect((await ctx.login('someone-else', 'wrong-wrong')).status).toBe(401);
  });
});

describe('public endpoint throttling', () => {
  it('allows 60 requests per minute per IP, then 429', async () => {
    for (let i = 0; i < 60; i++) expect((await ctx.http().get('/api/v1/public/copies/BK0000001')).status).toBe(404);
    const res = await ctx.http().get('/api/v1/public/copies/BK0000001');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
