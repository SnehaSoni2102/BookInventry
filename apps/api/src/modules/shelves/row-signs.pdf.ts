import { createPdf, drawText, pdfToBuffer, textWidth } from '../../common/pdf/pdf-text.js';

export interface SignRow {
  code: string;
  capacity: number;
  isOverflow: boolean;
  genre: { name: string; code: string; color: string } | null;
}

const isDark = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 160;
};

/** One A4 landscape sign per row: colour band, genre name, row code and slot range. */
export async function renderRowSigns(rows: SignRow[]): Promise<Buffer> {
  const doc = createPdf({ margin: 0 });
  const W = 842, H = 595; // A4 landscape in points
  for (const r of rows) {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
    const color = r.genre?.color ?? '#888888';
    const fg = isDark(color) ? '#FFFFFF' : '#111111';
    doc.rect(0, 0, W, 190).fill(color);
    const title = r.isOverflow ? 'OVERFLOW' : (r.genre?.name ?? 'UNASSIGNED');
    const size = textWidth(doc, title, { size: 56, bold: true }) > W - 80 ? 36 : 56;
    drawText(doc, title, 40, 60, { size, bold: true, color: fg, width: W - 80, align: 'center' });
    drawText(doc, r.genre?.code ?? '—', 40, 140, { size: 28, bold: true, color: fg, width: W - 80, align: 'center' });
    drawText(doc, r.code, 40, 230, { size: 160, bold: true, color: '#111111', width: W - 80, align: 'center' });
    drawText(doc, `Slots 1–${r.capacity}`, 40, 440, { size: 36, color: '#444444', width: W - 80, align: 'center' });
    if (r.isOverflow) {
      drawText(doc, 'Used when a genre’s own rows are full', 40, 500, { size: 20, color: '#666666', width: W - 80, align: 'center' });
    }
  }
  if (!rows.length) {
    doc.addPage({ size: 'A4', layout: 'landscape' });
    drawText(doc, 'No rows selected', 60, 60, { size: 24 });
  }
  return pdfToBuffer(doc);
}
