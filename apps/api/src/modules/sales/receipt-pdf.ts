import { formatMoney, type SaleDto } from '@bookstall/shared';
import { createPdf, drawText, pdfToBuffer, truncate, wrapLines } from '../../common/pdf/pdf-text.js';

export type ReceiptFormat = 'thermal' | 'a6';

const MM = 72 / 25.4;
const METHOD: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' };

/**
 * 80 mm thermal receipt (height fits the content) or an A6 page that is nice to share/print.
 * `tz` and `locale` come from the organisation settings.
 */
export async function renderReceipt(sale: SaleDto, org: { name: string; tz: string; locale: string }, format: ReceiptFormat): Promise<Buffer> {
  const thermal = format === 'thermal';
  const W = thermal ? 80 * MM : 105 * MM;
  const pad = thermal ? 10 : 24;
  const titleSize = thermal ? 8.5 : 10;
  const lineH = thermal ? 11 : 14;

  const doc = createPdf({ margin: 0, info: { Title: `Receipt ${sale.receiptNo}` } });
  const itemLines = sale.items.map((i) => wrapLines(doc, i.title, W - 2 * pad - 52, 2, { size: titleSize, bold: true }));
  const bodyLines = itemLines.reduce((a, l) => a + l.length + 1, 0);
  const H = thermal ? Math.max(180, 170 + bodyLines * lineH + (sale.customerName ? lineH : 0)) : 148 * MM;
  doc.addPage({ size: [W, H], margin: 0 });

  const when = new Date(sale.soldAt).toLocaleString(org.locale, { timeZone: org.tz, dateStyle: 'medium', timeStyle: 'short' });
  let y = pad;
  drawText(doc, truncate(doc, org.name, W - 2 * pad, { size: thermal ? 12 : 15, bold: true }), pad, y, { size: thermal ? 12 : 15, bold: true, width: W - 2 * pad, align: 'center' });
  y += thermal ? 20 : 26;
  drawText(doc, `Receipt ${sale.receiptNo}`, pad, y, { size: 9, bold: true, width: W - 2 * pad, align: 'center' });
  y += 13;
  drawText(doc, when, pad, y, { size: 8, color: '#444444', width: W - 2 * pad, align: 'center' });
  y += 11;
  drawText(doc, `${sale.soldAtLabel} · ${sale.seller.displayName}`, pad, y, { size: 8, color: '#444444', width: W - 2 * pad, align: 'center' });
  y += 14;
  if (sale.status === 'VOIDED') {
    drawText(doc, 'VOIDED', pad, y, { size: 14, bold: true, color: '#b00000', width: W - 2 * pad, align: 'center' });
    y += 20;
  }
  const rule = () => {
    doc.moveTo(pad, y).lineTo(W - pad, y).dash(1.5, { space: 2 }).strokeColor('#777777').lineWidth(0.5).stroke().undash();
    y += 6;
  };
  rule();

  sale.items.forEach((item, i) => {
    const price = formatMoney(item.soldPriceMinor);
    drawText(doc, price, pad, y, { size: titleSize, bold: true, width: W - 2 * pad, align: 'right' });
    for (const line of itemLines[i]!) {
      drawText(doc, line, pad, y, { size: titleSize, bold: true });
      y += lineH;
    }
    const discounted = item.soldPriceMinor !== item.listPriceMinor;
    drawText(doc, `${item.code}${discounted ? `  (list ${formatMoney(item.listPriceMinor)})` : ''}`, pad, y, { size: 7, color: '#555555' });
    y += lineH;
  });
  rule();

  drawText(doc, 'TOTAL', pad, y, { size: 11, bold: true });
  drawText(doc, formatMoney(sale.totalMinor), pad, y, { size: 11, bold: true, width: W - 2 * pad, align: 'right' });
  y += 16;
  drawText(doc, `Paid by ${METHOD[sale.paymentMethod] ?? sale.paymentMethod}`, pad, y, { size: 8 });
  y += lineH;
  if (sale.customerName) {
    drawText(doc, truncate(doc, `Customer: ${sale.customerName}`, W - 2 * pad, { size: 8 }), pad, y, { size: 8 });
    y += lineH;
  }
  y += 6;
  drawText(doc, 'Thank you for supporting us!', pad, y, { size: 8, width: W - 2 * pad, align: 'center' });
  return pdfToBuffer(doc);
}
