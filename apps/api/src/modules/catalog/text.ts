/** Strips HTML tags / entities / simple markdown links, collapses whitespace. */
export function stripMarkup(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Cleans a summary and trims it to `max` characters at a sentence boundary (hard cut + ellipsis if none). */
export function cleanSummary(input: string | null | undefined, max = 1500): string | null {
  if (!input) return null;
  const text = stripMarkup(input).replace(/^"|"$/g, '').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n'));
  if (lastEnd > max * 0.5) return head.slice(0, lastEnd + 1).trim();
  return head.slice(0, max - 1).trimEnd() + '…';
}

const LANG3_TO_2: Record<string, string> = {
  eng: 'en', hin: 'hi', mar: 'mr', ben: 'bn', tam: 'ta', tel: 'te', guj: 'gu', kan: 'kn', mal: 'ml',
  pan: 'pa', urd: 'ur', san: 'sa', ori: 'or', asm: 'as', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de',
  spa: 'es', ita: 'it', por: 'pt', rus: 'ru', chi: 'zh', zho: 'zh', jpn: 'ja', ara: 'ar',
};

/** Accepts "eng", "en", "/languages/eng" and returns a 2-letter code when known. */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.split('/').pop()!.toLowerCase();
  if (/^[a-z]{2}$/.test(code)) return code;
  return LANG3_TO_2[code] ?? null;
}

export function yearFrom(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const m = /(1[4-9]\d{2}|20\d{2}|2100)/.exec(String(raw));
  return m ? Number(m[1]) : null;
}

export function dedupe(values: Array<string | null | undefined>, limit = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
