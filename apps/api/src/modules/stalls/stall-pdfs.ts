import { formatMoney, type MovementDto, type PaymentMethod, type Reconciliation } from '@bookstall/shared';
import { createPdf, drawText, pdfToBuffer, truncate } from '../../common/pdf/pdf-text.js';
import type { PickListData } from './movements.service.js';

const MARGIN = 40;
const fmtDate = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** Rows are already in shelf order, so volunteers can walk the shelves once. */
export async function renderPickList(d: PickListData): Promise<Buffer> {
  const doc = createPdf({ margin: 0, info: { Title: `Pick list – ${d.stallName}` } });
  const W = 595.28, H = 841.89;
  const total = d.rows.reduce((a, r) => a + r.sellingPriceMinor, 0);
  let y = 0;

  const header = (first: boolean) => {
    doc.addPage({ size: 'A4', margin: 0 });
    y = MARGIN;
    if (first) {
      drawText(doc, 'Pick list', MARGIN, y, { size: 20, bold: true });
      drawText(doc, `For: ${d.stallName}`, MARGIN, y + 28, { size: 12, bold: true });
      drawText(doc, `${fmtDate(d.checkedOutAt)} · by ${d.checkedOutBy}`, MARGIN, y + 46, { size: 9, color: '#555555' });
      drawText(doc, `${d.rows.length} books · ${formatMoney(total)}`, MARGIN, y + 62, { size: 10 });
      y += 90;
    }
    drawText(doc, '✓', MARGIN, y, { size: 9, bold: true });
    drawText(doc, 'Location', MARGIN + 24, y, { size: 9, bold: true });
    drawText(doc, 'Code', MARGIN + 110, y, { size: 9, bold: true });
    drawText(doc, 'Title', MARGIN + 190, y, { size: 9, bold: true });
    drawText(doc, 'Price', W - MARGIN - 50, y, { size: 9, bold: true, width: 50, align: 'right' });
    y += 14;
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).strokeColor('#999999').lineWidth(0.5).stroke();
    y += 6;
  };

  header(true);
  for (const r of d.rows) {
    if (y > H - MARGIN - 40) header(false);
    doc.rect(MARGIN, y - 1, 10, 10).strokeColor('#000000').lineWidth(0.7).stroke();
    drawText(doc, r.locationCode ?? 'UNSHELVED', MARGIN + 24, y, { size: 10, bold: true });
    drawText(doc, r.code, MARGIN + 110, y, { size: 10 });
    drawText(doc, truncate(doc, r.title, W - MARGIN - 50 - (MARGIN + 190) - 8, { size: 10 }), MARGIN + 190, y, { size: 10 });
    drawText(doc, formatMoney(r.sellingPriceMinor), W - MARGIN - 50, y, { size: 10, width: 50, align: 'right' });
    y += 18;
  }
  doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).strokeColor('#999999').lineWidth(0.5).stroke();
  drawText(doc, `Total: ${d.rows.length} books · ${formatMoney(total)}`, MARGIN, y + 8, { size: 11, bold: true });
  return pdfToBuffer(doc);
}

const METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'OTHER'];

export async function renderStallReport(r: Reconciliation, movements: MovementDto[]): Promise<Buffer> {
  const doc = createPdf({ margin: 0, info: { Title: `Stall report – ${r.stall.name}` } });
  const W = 595.28, H = 841.89;
  doc.addPage({ size: 'A4', margin: 0 });
  let y = MARGIN;
  drawText(doc, 'Stall report', MARGIN, y, { size: 20, bold: true });
  drawText(doc, `${r.stall.name} · ${r.stall.status}`, MARGIN, y + 28, { size: 12, bold: true });
  y += 64;

  const kv = (label: string, value: string, x: number, yy: number) => {
    drawText(doc, label, x, yy, { size: 9, color: '#555555' });
    drawText(doc, value, x, yy + 12, { size: 16, bold: true });
  };
  kv('Sent', String(r.sent), MARGIN, y);
  kv('Sold', String(r.sold), MARGIN + 100, y);
  kv('Returned', String(r.returned), MARGIN + 200, y);
  kv('Missing / lost', String(r.lost + r.stillOut.length), MARGIN + 300, y);
  kv('Revenue', formatMoney(r.revenueMinor), MARGIN + 420, y);
  y += 56;

  drawText(doc, 'Revenue by payment method', MARGIN, y, { size: 11, bold: true });
  y += 18;
  for (const m of METHODS) {
    drawText(doc, m, MARGIN, y, { size: 10 });
    drawText(doc, formatMoney(r.byPaymentMethod[m]), MARGIN + 80, y, { size: 10, width: 80, align: 'right' });
    y += 15;
  }
  y += 10;

  const section = (title: string, rows: string[][], widths: number[]) => {
    if (y > H - 120) { doc.addPage({ size: 'A4', margin: 0 }); y = MARGIN; }
    drawText(doc, title, MARGIN, y, { size: 11, bold: true });
    y += 18;
    if (!rows.length) { drawText(doc, 'None', MARGIN, y, { size: 10, color: '#555555' }); y += 20; return; }
    for (const row of rows) {
      if (y > H - MARGIN - 20) { doc.addPage({ size: 'A4', margin: 0 }); y = MARGIN; }
      let x = MARGIN;
      row.forEach((cell, i) => {
        drawText(doc, truncate(doc, cell, widths[i]! - 6, { size: 9 }), x, y, { size: 9 });
        x += widths[i]!;
      });
      y += 14;
    }
    y += 12;
  };

  section('Still out (not returned, not sold)', r.stillOut.map((b) => [b.code, b.title, b.locationCode ?? '', formatMoney(b.sellingPriceMinor)]), [80, 280, 90, 65]);
  section('All books sent', movements.map((m) => [m.copy.code, m.copy.title, m.outcome, fmtDate(new Date(m.checkedOutAt))]), [80, 250, 70, 115]);
  return pdfToBuffer(doc);
}
