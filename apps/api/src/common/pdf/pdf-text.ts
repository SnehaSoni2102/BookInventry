import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
const FILES = {
  latin: 'NotoSans-Regular.woff',
  latinBold: 'NotoSans-Bold.woff',
  deva: 'NotoSansDevanagari-Regular.woff',
  devaBold: 'NotoSansDevanagari-Bold.woff',
} as const;

/** Devanagari block plus the rupee sign, which the Latin subset of Noto Sans lacks. */
const needsDeva = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x0900 && c <= 0x097f) || c === 0x20b9 || c === 0x200c || c === 0x200d;
};

export function registerFonts(doc: PDFKit.PDFDocument): void {
  for (const [name, file] of Object.entries(FILES)) doc.registerFont(name, FONT_DIR + file);
}

export function createPdf(options: PDFKit.PDFDocumentOptions = {}): PDFKit.PDFDocument {
  const doc = new PDFDocument({ autoFirstPage: false, ...options });
  registerFonts(doc);
  return doc;
}

interface Run {
  text: string;
  deva: boolean;
}

/** Splits into runs that each fit one font. Neutral characters (space, digits, punctuation) stay Latin. */
export function splitRuns(s: string): Run[] {
  const runs: Run[] = [];
  for (const ch of s) {
    const deva = needsDeva(ch) || (ch === ' ' && runs.at(-1)?.deva === true);
    const last = runs.at(-1);
    if (last && last.deva === deva) last.text += ch;
    else runs.push({ text: ch, deva });
  }
  return runs;
}

const fontFor = (deva: boolean, bold: boolean) => (deva ? (bold ? 'devaBold' : 'deva') : bold ? 'latinBold' : 'latin');

export interface TextStyle {
  size: number;
  bold?: boolean;
}

export function textWidth(doc: PDFKit.PDFDocument, s: string, { size, bold = false }: TextStyle): number {
  let w = 0;
  for (const r of splitRuns(s)) w += doc.font(fontFor(r.deva, bold)).fontSize(size).widthOfString(r.text);
  return w;
}

/** Truncates to `maxWidth`, ending with an ellipsis if anything was cut. */
export function truncate(doc: PDFKit.PDFDocument, s: string, maxWidth: number, style: TextStyle): string {
  if (textWidth(doc, s, style) <= maxWidth) return s;
  const chars = [...s];
  while (chars.length > 1 && textWidth(doc, chars.join('').trimEnd() + '…', style) > maxWidth) chars.pop();
  return chars.join('').trimEnd() + '…';
}

/** Greedy word wrap to at most `maxLines`; the last line is ellipsised if text remains. */
export function wrapLines(
  doc: PDFKit.PDFDocument,
  s: string,
  maxWidth: number,
  maxLines: number,
  style: TextStyle,
): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]!;
    if (textWidth(doc, next, style) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = words[i]!;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length === maxLines - 1) {
    const rest = [cur, ...words.slice(i + 1)].filter(Boolean).join(' ');
    lines.push(truncate(doc, rest, maxWidth, style));
  } else if (cur) lines.push(truncate(doc, cur, maxWidth, style));
  return lines.map((l) => truncate(doc, l, maxWidth, style));
}

/** Draws one line, switching fonts per run. Returns the width drawn. */
export function drawText(
  doc: PDFKit.PDFDocument,
  s: string,
  x: number,
  y: number,
  style: TextStyle & { color?: string; align?: 'left' | 'center' | 'right'; width?: number },
): number {
  const w = textWidth(doc, s, style);
  let cx = x;
  if (style.width !== undefined && style.align === 'center') cx = x + (style.width - w) / 2;
  if (style.width !== undefined && style.align === 'right') cx = x + style.width - w;
  doc.fillColor(style.color ?? '#000000');
  for (const r of splitRuns(s)) {
    doc.font(fontFor(r.deva, style.bold ?? false)).fontSize(style.size);
    doc.text(r.text, cx, y, { lineBreak: false });
    cx += doc.widthOfString(r.text);
  }
  return w;
}

export function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
