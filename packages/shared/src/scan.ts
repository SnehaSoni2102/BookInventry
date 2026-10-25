import { cleanIsbn, isValidIsbn10, isValidIsbn13, isbn10To13 } from './isbn';

export type ScanResult =
  | { kind: 'copy'; code: string }
  | { kind: 'isbn'; isbn13: string }
  | { kind: 'unknown'; raw: string };

const COPY_URL_PATH = /\/b\/([A-Za-z]{2,4}\d{7})\/?$/;
const COPY_CODE = /^[A-Za-z]{2,4}\d{7}$/;

export function parseScan(raw: string): ScanResult {
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();

  if (/^https?:\/\//i.test(value)) {
    let path = value;
    try {
      path = new URL(value).pathname;
    } catch {
      /* fall through with the raw string */
    }
    const m = COPY_URL_PATH.exec(path);
    if (m) return { kind: 'copy', code: m[1]!.toUpperCase() };
    return { kind: 'unknown', raw };
  }

  if (COPY_CODE.test(value)) return { kind: 'copy', code: value.toUpperCase() };

  const compact = cleanIsbn(value);
  // EAN-13 with a 2- or 5-digit supplemental add-on (e.g. price code 51499)
  const withAddon = /^(97[89]\d{10})(\d{2}|\d{5})$/.exec(compact);
  const candidate = withAddon ? withAddon[1]! : compact;

  if (isValidIsbn13(candidate)) return { kind: 'isbn', isbn13: candidate };
  if (isValidIsbn10(candidate)) {
    const isbn13 = isbn10To13(candidate);
    if (isbn13) return { kind: 'isbn', isbn13 };
  }
  return { kind: 'unknown', raw };
}
