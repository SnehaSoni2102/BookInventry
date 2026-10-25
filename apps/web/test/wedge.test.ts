import { describe, expect, it } from 'vitest';
import { isEditable, WedgeDetector } from '../src/lib/wedge';

/** Feeds `text` then Enter with `gap` ms between keystrokes, starting at `t0`. */
function type(d: WedgeDetector, text: string, gap: number, t0 = 1000): string | null {
  let t = t0;
  for (const ch of text) {
    d.push(ch, t);
    t += gap;
  }
  return d.push('Enter', t);
}

describe('WedgeDetector', () => {
  it('recognises a scanner burst (a few ms per key) followed by Enter', () => {
    expect(type(new WedgeDetector(), 'BK0000123', 3)).toBe('BK0000123');
    expect(type(new WedgeDetector(), '9780143127550', 8)).toBe('9780143127550');
    expect(type(new WedgeDetector(), 'https://x.org/b/BK0000123', 2)).toBe('https://x.org/b/BK0000123');
  });

  it('ignores a person typing at human speed', () => {
    expect(type(new WedgeDetector(), 'BK0000123', 120)).toBeNull();
    expect(type(new WedgeDetector(), 'hello world', 90)).toBeNull();
  });

  it('ignores short bursts (not enough characters to be a code)', () => {
    expect(type(new WedgeDetector(), 'abc', 2)).toBeNull();
  });

  it('ignores Enter that comes long after the last character', () => {
    const d = new WedgeDetector();
    for (const [i, ch] of [...'BK0000123'].entries()) d.push(ch, 1000 + i * 3);
    expect(d.push('Enter', 1000 + 8 * 3 + 500)).toBeNull();
  });

  it('is not confused by a slow keystroke followed by a fast burst: the burst wins', () => {
    const d = new WedgeDetector();
    d.push('x', 100); // stray key typed earlier
    expect(type(d, 'BK0000123', 3, 2000)).toBe('BK0000123');
  });

  it('scans twice in a row', () => {
    const d = new WedgeDetector();
    expect(type(d, 'BK0000001', 3, 1000)).toBe('BK0000001');
    expect(type(d, 'BK0000002', 3, 1500)).toBe('BK0000002');
  });

  it('modifier keys do not break a burst', () => {
    const d = new WedgeDetector();
    let t = 1000;
    for (const k of ['B', 'Shift', 'K', '0', '0', '0', '0', '1', '2', '3']) d.push(k, (t += 3));
    expect(d.push('Enter', t + 3)).toBe('BK0000123');
  });

  it('reports a burst in progress so hotkeys can be suppressed', () => {
    const d = new WedgeDetector();
    d.push('B', 1000);
    d.push('K', 1004);
    expect(d.inBurst(1008)).toBe(true);
    expect(d.inBurst(1500)).toBe(false);
    d.reset();
    expect(d.inBurst(1008)).toBe(false);
  });
});

describe('isEditable', () => {
  it('is true for form fields and contenteditable, false otherwise', () => {
    expect(isEditable(document.createElement('input'))).toBe(true);
    expect(isEditable(document.createElement('textarea'))).toBe(true);
    expect(isEditable(document.createElement('select'))).toBe(true);
    expect(isEditable(document.createElement('div'))).toBe(false);
    expect(isEditable(null)).toBe(false);
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditable(div)).toBe(true);
  });
});
