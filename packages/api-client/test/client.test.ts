import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, createApiClient } from '../src/client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauth = () => json({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401);

function setup(fetchImpl: typeof fetch, platform: 'web' | 'mobile' = 'web') {
  let token: string | null = 'old';
  const onLogout = vi.fn();
  const onSession = vi.fn();
  const client = createApiClient({
    baseUrl: '/api/v1', platform, fetchImpl,
    getAccessToken: () => token, setAccessToken: (t) => (token = t),
    getRefreshToken: () => 'mobile-refresh', onLogout, onSession,
  });
  return { client, onLogout, onSession, token: () => token };
}

describe('buildQuery', () => {
  it('repeats array keys and skips empty values', () => {
    expect(buildQuery({ q: 'a b', genreId: ['1', '2'], page: 2, empty: '', no: undefined, nul: null, flag: false })).toBe('?q=a+b&genreId=1&genreId=2&page=2&flag=false');
    expect(buildQuery()).toBe('');
    expect(buildQuery({})).toBe('');
  });
});

describe('api client', () => {
  it('sends the bearer token and JSON, and parses the response', async () => {
    const f = vi.fn(async () => json({ ok: true }));
    const { client } = setup(f as never);
    expect(await client.request('POST', '/things', { body: { a: 1 }, query: { x: 1 } })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/things?x=1');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer old', 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe('include');
  });

  it('turns the error envelope into an ApiError', async () => {
    const { client } = setup((async () => json({ error: { code: 'COPY_NOT_AVAILABLE', message: 'gone', details: { codes: ['BK1'] } } }, 409)) as never);
    const err = await client.request('POST', '/sales').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'COPY_NOT_AVAILABLE', status: 409, message: 'gone', details: { codes: ['BK1'] } });
  });

  it('reports network failures distinctly', async () => {
    const { client } = setup((async () => { throw new TypeError('Failed to fetch'); }) as never);
    expect(await client.request('GET', '/x').catch((e) => e)).toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('refreshes once (single flight) when several requests hit 401, then retries them all', async () => {
    let refreshCalls = 0;
    const f = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return json({ accessToken: 'new', user: {}, mustChangePassword: false });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json({ n: 1 }) : unauth();
    });
    const { client, token, onSession, onLogout } = setup(f as never);
    const results = await Promise.all([client.request('GET', '/a'), client.request('GET', '/b'), client.request('GET', '/c')]);
    expect(results).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
    expect(refreshCalls).toBe(1);
    expect(token()).toBe('new');
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('logs out when the refresh fails', async () => {
    const f = vi.fn(async (input: string) => (input.endsWith('/auth/refresh') ? unauth() : unauth()));
    const { client, onLogout } = setup(f as never);
    expect(await client.request('GET', '/a').catch((e) => e)).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh for anonymous calls, and mobile sends its refresh token in the body', async () => {
    const f = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/auth/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'mobile-refresh' });
        expect(init?.credentials).toBe('omit');
        return json({ accessToken: 'n2', user: {}, mustChangePassword: false });
      }
      return unauth();
    });
    const anon = setup(f as never, 'mobile');
    await anon.client.request('POST', '/auth/login', { anonymous: true, body: {} }).catch(() => undefined);
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))).toHaveLength(0);
    await anon.client.request('GET', '/me').catch(() => undefined);
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('returns undefined for 204 and a Blob for downloads', async () => {
    const f = vi.fn(async (input: string) => (input.includes('pdf') ? new Response('%PDF-', { headers: { 'content-type': 'application/pdf' } }) : new Response(null, { status: 204 })));
    const { client } = setup(f as never);
    expect(await client.request('DELETE', '/x')).toBeUndefined();
    const blob = await client.blob('GET', '/file.pdf');
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF-');
  });
});
