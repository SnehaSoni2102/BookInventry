import { parseScan, type CopyAction, type CopyDetail, type CheckinItem, type CopyGroup } from '@bookstall/shared';
import type { Api } from './endpoints.js';
import { ApiError } from './client.js';

/**
 * What a scan means depends on where it happened:
 *  - default: jump to the copy page / start "add book" for an ISBN
 *  - lookup / sell / checkout / checkin / labels: feed the mode's list (scan station, cart, ...)
 */
export type ScanMode = 'default' | 'lookup' | 'sell' | 'checkout' | 'checkin' | 'labels';

export type ScanOutcome =
  | { type: 'navigate'; to: string }
  | { type: 'copy'; copy: CopyDetail; actions: CopyAction[] }
  | { type: 'blocked'; code: string; title: string; reason: 'COPY_NOT_AT_YOUR_STALL' }
  | { type: 'checked-in'; item: CheckinItem }
  | { type: 'checkin-failed'; code: string; reason: string }
  | { type: 'add-book'; isbn13: string }
  | { type: 'choose-copy'; isbn13: string; titleId: string; copyGroups: CopyGroup[] }
  | { type: 'unknown'; raw: string }
  | { type: 'not-found'; code: string }
  | { type: 'error'; message: string };

export interface ScanContext {
  mode: ScanMode;
}

/** Ignores the same value scanned again within `windowMs` (cameras re-read a label many times a second). */
export class ScanDeduper {
  private last = new Map<string, number>();
  constructor(private readonly windowMs = 2000) {}
  accept(value: string, now = Date.now()): boolean {
    const prev = this.last.get(value);
    this.last.set(value, now);
    for (const [k, t] of this.last) if (now - t > this.windowMs * 5) this.last.delete(k);
    return prev === undefined || now - prev > this.windowMs;
  }
}

export async function handleScan(api: Api, raw: string, ctx: ScanContext): Promise<ScanOutcome> {
  const parsed = parseScan(raw);
  if (parsed.kind === 'unknown') return { type: 'unknown', raw };
  try {
    if (parsed.kind === 'copy') {
      // Check-in is the one mode that acts immediately: one scan, one book back on the shelf.
      if (ctx.mode === 'checkin') {
        const res = await api.stalls.checkin({ clientRef: crypto.randomUUID(), codes: [parsed.code] });
        if (res.checkedIn[0]) return { type: 'checked-in', item: res.checkedIn[0] };
        const f = res.failed[0];
        return { type: 'checkin-failed', code: parsed.code, reason: f?.reason === 'NOT_AT_STALL' ? 'This book is not checked out to a stall' : 'No book with that code' };
      }
      const r = await api.scan.resolve(parsed.code);
      if (r.kind !== 'copy') return { type: 'unknown', raw };
      if ('blocked' in r) return { type: 'blocked', code: r.copy.code, title: r.copy.title, reason: r.blocked };
      if (ctx.mode === 'default') return { type: 'navigate', to: `/copies/${r.copy.code}` };
      return { type: 'copy', copy: r.copy, actions: r.actions };
    }
    // ISBN
    if (ctx.mode === 'default') return { type: 'add-book', isbn13: parsed.isbn13 };
    const r = await api.scan.resolve(parsed.isbn13);
    if (r.kind === 'isbn' && r.titleId && r.copyGroups) return { type: 'choose-copy', isbn13: parsed.isbn13, titleId: r.titleId, copyGroups: r.copyGroups };
    return { type: 'add-book', isbn13: parsed.isbn13 };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { type: 'not-found', code: parsed.kind === 'copy' ? parsed.code : parsed.isbn13 };
    return { type: 'error', message: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

/** Human-readable text for API error codes (shown in toasts and inline). */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : 'Something went wrong';
  const d = e.details as { codes?: string[] } | undefined;
  const codes = d?.codes?.length ? ` (${d.codes.slice(0, 5).join(', ')})` : '';
  switch (e.code) {
    case 'COPY_NOT_AVAILABLE': return `This book was already sold or isn't available${codes}`;
    case 'COPY_NOT_AT_YOUR_STALL': return `This book isn't at your stall${codes}`;
    case 'STALL_NOT_ACTIVE': return e.message || 'The stall is not open for sales';
    case 'DISCOUNT_NOT_ALLOWED': return 'Only an admin can change the price';
    case 'VERSION_CONFLICT': return 'Someone else changed this just now. Reload and try again.';
    case 'NO_SHELF_SPACE': return 'There is no free shelf space for this genre';
    case 'RATE_LIMITED': return 'Too many attempts. Please wait a minute.';
    case 'NETWORK': return e.message;
    case 'FORBIDDEN': return "You don't have permission to do that";
    default: return e.message;
  }
}
