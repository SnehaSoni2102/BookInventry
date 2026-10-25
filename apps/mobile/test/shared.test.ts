import { can, parseScan } from '@bookstall/shared';
import { ScanDeduper } from '@bookstall/api-client';

// The mobile app depends on these shared behaviours; guard them against accidental breakage.
describe('shared logic used by the app', () => {
  it('parses a sticker scanned with any domain', () => {
    expect(parseScan('https://books.example.org/b/bk0000123')).toEqual({ kind: 'copy', code: 'BK0000123' });
    expect(parseScan('9780143127550')).toEqual({ kind: 'isbn', isbn13: '9780143127550' });
  });
  it('ignores repeated camera reads within two seconds', () => {
    const d = new ScanDeduper(2000);
    expect(d.accept('BK0000001', 0)).toBe(true);
    expect(d.accept('BK0000001', 900)).toBe(false);
    expect(d.accept('BK0000001', 3000)).toBe(true);
  });
  it('limits what a stall manager can do', () => {
    expect(can({ role: 'STALL_MANAGER' }, 'sale.create.stall')).toBe(true);
    expect(can({ role: 'STALL_MANAGER' }, 'stall.checkout')).toBe(false);
    expect(can({ role: 'STALL_MANAGER' }, 'inventory.read')).toBe(false);
  });
});
