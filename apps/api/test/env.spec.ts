import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('refuses to boot without DATABASE_URL', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
  });
  it('requires a JWT secret in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db' })).toThrow(/JWT_ACCESS_SECRET/);
  });
  it('applies defaults', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@h/db' });
    expect(env.PORT).toBe(3000);
    expect(env.STORAGE_DRIVER).toBe('local');
  });
});
