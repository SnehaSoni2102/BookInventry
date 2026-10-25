import { formatMoney, type LabelTemplate } from '@bookstall/shared';
import { createPdf, drawText, pdfToBuffer, truncate, wrapLines } from '../../common/pdf/pdf-text.js';
import { code128Png, qrPayload, qrPng } from './qr.js';

export interface LabelData {
  code: string;
  title: string;
  authors: string[];
  condition: string;
  sellingPriceMinor: number;
  originalPriceMinor: number | null;
  locationCode: string | null;
}

export interface RenderOptions {
  template: LabelTemplate;
  startPosition: number;
  publicBaseUrl: string;
  orgName: string;
}

const MM = 72 / 25.4;
const CONDITION_TEXT: Record<string, string> = {
  NEW: 'NEW', LIKE_NEW: 'LIKE NEW', VERY_GOOD: 'VERY GOOD', GOOD: 'GOOD', FAIR: 'FAIR', POOR: 'POOR',
};

/** Label geometry in points. The thermal label is the base design; the A4 cell is scaled copy of it. */
const BASE_W = 50 * MM;
const BASE_H = { THERMAL_50x25: 25 * MM, THERMAL_50x30_1D: 30 * MM, A4_24: 25 * MM } as const;
const A4 = { w: 210 * MM, h: 297 * MM, cols: 3, rows: 8, cellW: 70 * MM, cellH: 37 * MM };

export function sheetPositions(startPosition: number, count: number): Array<{ page: number; col: number; row: number }> {
  const perPage = A4.cols * A4.rows;
  return Array.from({ length: count }, (_, i) => {
    const slot = startPosition - 1 + i;
    const inPage = slot % perPage;
    return { page: Math.floor(slot / perPage), col: inPage % A4.cols, row: Math.floor(inPage / A4.cols) };
  });
}

function drawLabel(
  doc: PDFKit.PDFDocument,
  l: LabelData,
  qr: Buffer,
  bar: Buffer | null,
  opts: RenderOptions,
) {
  const colX = 65;
  const colW = BASE_W - colX - 4;
  doc.image(qr, 4, 7, { width: 20 * MM });

  drawText(doc, l.code, colX, 4, { size: 6.5, bold: true });
  const org = truncate(doc, opts.orgName, colW - 44, { size: 5 });
  drawText(doc, org, colX, 5.2, { size: 5, color: '#444444', width: colW, align: 'right' });

  let y = 13;
  for (const line of wrapLines(doc, l.title, colW, 2, { size: 7, bold: true })) {
    drawText(doc, line, colX, y, { size: 7, bold: true });
    y += 8.5;
  }
  const author = l.authors[0];
  if (author) drawText(doc, truncate(doc, author, colW, { size: 6 }), colX, 31.5, { size: 6 });

  const price = `${CONDITION_TEXT[l.condition] ?? l.condition}  ${formatMoney(l.sellingPriceMinor)}`;
  drawText(doc, truncate(doc, price, colW, { size: 8, bold: true }), colX, 40.5, { size: 8, bold: true });
  if (l.originalPriceMinor !== null) {
    drawText(doc, `MRP ${formatMoney(l.originalPriceMinor)}`, colX, 50, { size: 5.5, color: '#444444' });
  }
  drawText(doc, truncate(doc, l.locationCode ?? 'UNSHELVED', colW, { size: 7.5, bold: true }), colX, 58.5, { size: 7.5, bold: true });

  if (bar) doc.image(bar, 8, 68, { width: BASE_W - 16, height: 13 });
}

export async function renderLabels(labels: LabelData[], opts: RenderOptions): Promise<Buffer> {
  const doc = createPdf({ margin: 0, info: { Title: 'Book labels' } });
  const qrs = await Promise.all(labels.map((l) => qrPng(qrPayload(opts.publicBaseUrl, l.code))));
  const bars = opts.template === 'THERMAL_50x30_1D' ? await Promise.all(labels.map((l) => code128Png(l.code))) : [];

  if (opts.template === 'A4_24') {
    const scale = Math.min(A4.cellW / BASE_W, A4.cellH / BASE_H.A4_24);
    const dx = (A4.cellW - BASE_W * scale) / 2;
    const dy = (A4.cellH - BASE_H.A4_24 * scale) / 2;
    const pos = sheetPositions(opts.startPosition, labels.length);
    let currentPage = -1;
    labels.forEach((l, i) => {
      const p = pos[i]!;
      if (p.page !== currentPage) {
        doc.addPage({ size: [A4.w, A4.h], margin: 0 });
        currentPage = p.page;
      }
      doc.save();
      doc.translate(p.col * A4.cellW + dx, p.row * A4.cellH + dy);
      doc.scale(scale);
      drawLabel(doc, l, qrs[i]!, null, opts);
      doc.restore();
    });
    if (!labels.length) doc.addPage({ size: [A4.w, A4.h], margin: 0 });
  } else {
    const h = BASE_H[opts.template];
    labels.forEach((l, i) => {
      doc.addPage({ size: [BASE_W, h], margin: 0 });
      drawLabel(doc, l, qrs[i]!, bars[i] ?? null, opts);
    });
    if (!labels.length) doc.addPage({ size: [BASE_W, h], margin: 0 });
  }
  return pdfToBuffer(doc);
}
