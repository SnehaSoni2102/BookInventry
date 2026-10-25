/** Formats integer minor units (paise) for display. Whole amounts drop the decimals. */
export function formatMoney(minor: number, currency = 'INR', locale = 'en-IN'): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * Parses "150", "150.5", "1,500.50" or "₹150" into integer minor units.
 * Returns null for anything else (negative numbers, >2 decimals, garbage).
 */
export function parseMoneyToMinor(input: string): number | null {
  const s = input.replace(/[₹\s,]/g, '').replace(/^(rs\.?|inr)/i, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Rounds to the nearest `step` minor units (e.g. 1000 = ₹10). */
export function roundToStep(minor: number, step: number): number {
  if (step <= 1) return Math.round(minor);
  return Math.round(minor / step) * step;
}
