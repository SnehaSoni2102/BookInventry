import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/client';
import { handleScan, ScanDeduper, errorMessage } from '../src/scan-handler';
import { invalidationsFor } from '../src/realtime';
import { qk } from '../src/keys';

const copyDetail = { code: 'BK0000001', locationCode: 'FIC-A01-001' };
function fakeApi(over: Record<string, unknown> = {}) {
  return {
    scan: { resolve: vi.fn(async (v: string) => (v.startsWith('BK') ? { kind: 'copy', copy: copyDetail, actions: [{ action: 'SELL' }] } : { kind: 'isbn', isbn13: v })) },
    stalls: { checkin: vi.fn(async () => ({ checkedIn: [{ code: 'BK0000001', returnToLocation: 'FIC-A01-001' }], failed: [] })) },
    ...over,
  } as never;
}

describe('handleScan', () => {
  it('navigates to the copy in the default context and accepts URLs', async () => {
    expect(await handleScan(fakeApi(), 'https://x.org/b/BK0000001', { mode: 'default' })).toEqual({ type: 'navigate', to: '/copies/BK0000001' });
  });
  it('feeds the list in sell/checkout modes', async () => {
    expect(await handleScan(fakeApi(), 'bk0000001', { mode: 'sell' })).toMatchObject({ type: 'copy', actions: [{ action: 'SELL' }] });
  });
  it('checks in immediately in check-in mode, without a resolve call', async () => {
    const api = fakeApi();
    const out = await handleScan(api, 'BK0000001', { mode: 'checkin' });
    expect(out).toMatchObject({ type: 'checked-in', item: { returnToLocation: 'FIC-A01-001' } });
    expect((api as never as { scan: { resolve: ReturnType<typeof vi.fn> } }).scan.resolve).not.toHaveBeenCalled();
  });
  it('explains a failed check-in', async () => {
    const api = fakeApi({ stalls: { checkin: async () => ({ checkedIn: [], failed: [{ code: 'BK0000001', reason: 'NOT_AT_STALL' }] }) } });
    expect(await handleScan(api, 'BK0000001', { mode: 'checkin' })).toMatchObject({ type: 'checkin-failed', reason: expect.stringContaining('not checked out') });
  });
  it('treats a managers blocked scan as blocked', async () => {
    const api = fakeApi({ scan: { resolve: async () => ({ kind: 'copy', blocked: 'COPY_NOT_AT_YOUR_STALL', copy: { code: 'BK0000009', title: 'T', authors: [] }, actions: [] }) } });
    expect(await handleScan(api, 'BK0000009', { mode: 'sell' })).toMatchObject({ type: 'blocked', code: 'BK0000009' });
  });
  it('sends ISBNs to Add Book by default and offers copies in sell/checkout modes', async () => {
    expect(await handleScan(fakeApi(), '9780306406157', { mode: 'default' })).toEqual({ type: 'add-book', isbn13: '9780306406157' });
    const api = fakeApi({ scan: { resolve: async () => ({ kind: 'isbn', isbn13: '9780306406157', titleId: 't1', copyGroups: [{ quantity: 2 }] }) } });
    expect(await handleScan(api, '9780306406157', { mode: 'sell' })).toMatchObject({ type: 'choose-copy', titleId: 't1' });
  });
  it('reports junk, unknown codes and errors', async () => {
    expect(await handleScan(fakeApi(), 'hello', { mode: 'default' })).toEqual({ type: 'unknown', raw: 'hello' });
    const missing = fakeApi({ scan: { resolve: async () => { throw new ApiError('NOT_FOUND', 'x', 404); } } });
    expect(await handleScan(missing, 'BK0000001', { mode: 'sell' })).toEqual({ type: 'not-found', code: 'BK0000001' });
    const broken = fakeApi({ scan: { resolve: async () => { throw new ApiError('NETWORK', 'offline', 0); } } });
    expect(await handleScan(broken, 'BK0000001', { mode: 'sell' })).toEqual({ type: 'error', message: 'offline' });
  });
});

describe('ScanDeduper', () => {
  it('ignores repeats within the window only', () => {
    const d = new ScanDeduper(2000);
    expect(d.accept('A', 0)).toBe(true);
    expect(d.accept('A', 500)).toBe(false);
    expect(d.accept('B', 600)).toBe(true);
    expect(d.accept('A', 2600)).toBe(true);
  });
});

describe('errorMessage / realtime mapping', () => {
  it('maps codes to friendly text', () => {
    expect(errorMessage(new ApiError('COPY_NOT_AVAILABLE', 'x', 409, { codes: ['BK1'] }))).toBe("This book was already sold or isn't available (BK1)");
    expect(errorMessage(new ApiError('DISCOUNT_NOT_ALLOWED', 'x', 403))).toBe('Only an admin can change the price');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
  it('invalidates the right queries per event', () => {
    expect(invalidationsFor('sale.created', {})).toEqual(expect.arrayContaining([qk.sales.all(), qk.titles.all(), qk.dashboard()]));
    expect(invalidationsFor('title.updated', { titleId: 't1' })).toContainEqual(qk.titles.one('t1'));
    expect(invalidationsFor('whatever', {})).toEqual([]);
  });
});
