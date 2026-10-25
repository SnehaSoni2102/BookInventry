/** Strips hyphens/spaces and uppercases a trailing X. */
export function cleanIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidIsbn13(value: string): boolean {
  const s = cleanIsbn(value);
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

export function isValidIsbn10(value: string): boolean {
  const s = cleanIsbn(value);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i]!;
    sum += (10 - i) * (c === 'X' ? 10 : Number(c));
  }
  return sum % 11 === 0;
}

export function isbn13Checksum(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Converts a valid ISBN-10 into ISBN-13. Returns null when the input is invalid. */
export function isbn10To13(value: string): string | null {
  const s = cleanIsbn(value);
  if (!isValidIsbn10(s)) return null;
  const body = '978' + s.slice(0, 9);
  return body + isbn13Checksum(body);
}

/** Converts a 978-prefixed ISBN-13 into ISBN-10. Returns null for 979 or invalid input. */
export function isbn13To10(value: string): string | null {
  const s = cleanIsbn(value);
  if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
  const body = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(body[i]);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}

/** Returns a normalized ISBN-13 for any valid ISBN-10/13 input, otherwise null. */
export function toIsbn13(value: string): string | null {
  const s = cleanIsbn(value);
  if (isValidIsbn13(s)) return s;
  return isbn10To13(s);
}
