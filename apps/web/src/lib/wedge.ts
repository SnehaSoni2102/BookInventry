export interface WedgeOptions {
  /** Max gap between keystrokes of one scan. Scanners type in ~1–10 ms; people take 100+ ms. */
  maxGapMs?: number;
  minLength?: number;
}

/**
 * Tells a keyboard-wedge scanner (types the code then presses Enter, very fast) apart from a person typing.
 * Pure logic with an injectable clock so it can be unit-tested.
 */
export class WedgeDetector {
  private buffer = '';
  private last = 0;
  private readonly maxGap: number;
  private readonly minLength: number;

  constructor(opts: WedgeOptions = {}) {
    this.maxGap = opts.maxGapMs ?? 35;
    this.minLength = opts.minLength ?? 6;
  }

  /** Feed every keydown. Returns the scanned value when Enter completes a burst, otherwise null. */
  push(key: string, now: number): string | null {
    if (key === 'Enter') {
      const fast = now - this.last <= this.maxGap * 2;
      const value = this.buffer;
      this.buffer = '';
      return value.length >= this.minLength && fast ? value : null;
    }
    if (key.length !== 1) return null; // Shift, Tab, arrows… do not break a burst
    this.buffer = now - this.last > this.maxGap ? key : this.buffer + key;
    this.last = now;
    return null;
  }

  /** True while characters are arriving at scanner speed (used to suppress hotkeys like "/"). */
  inBurst(now: number): boolean {
    return this.buffer.length >= 2 && now - this.last <= this.maxGap;
  }

  reset(): void {
    this.buffer = '';
  }
}

export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
