/**
 * Lowercase, strip Latin diacritics, drop punctuation, collapse whitespace.
 * Only Latin combining marks (U+0300–U+036F) are removed so Devanagari vowel signs survive.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function searchText(parts: {
  title: string;
  subtitle?: string | null;
  authors?: readonly string[];
  isbn13?: string | null;
  isbn10?: string | null;
}): string {
  return normalizeText(
    [parts.title, parts.subtitle ?? '', ...(parts.authors ?? []), parts.isbn13 ?? '', parts.isbn10 ?? '']
      .filter(Boolean)
      .join(' '),
  );
}

const LEADING_ARTICLE = /^(the|a|an) /;

export function titleSort(title: string): string {
  const n = normalizeText(title);
  const stripped = n.replace(LEADING_ARTICLE, '');
  return stripped || n;
}

/** "J. K. Rowling" → "rowling j k"; "Rowling, J. K." → "rowling j k". */
export function authorSort(authors: readonly string[]): string {
  const first = authors[0];
  if (!first) return '';
  if (first.includes(',')) return normalizeText(first);
  const tokens = normalizeText(first).split(' ').filter(Boolean);
  if (tokens.length <= 1) return tokens.join(' ');
  const last = tokens[tokens.length - 1]!;
  return [last, ...tokens.slice(0, -1)].join(' ');
}
