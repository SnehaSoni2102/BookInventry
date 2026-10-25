import ExcelJS from 'exceljs';
import type { MovementDto, PaymentMethod, Reconciliation } from '@bookstall/shared';

export async function renderStallXlsx(r: Reconciliation, movements: MovementDto[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bookstall';
  const rupees = (minor: number) => minor / 100;

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 28 }, { width: 18 }];
  summary.addRows([
    ['Stall', r.stall.name],
    ['Status', r.stall.status],
    ['Books sent', r.sent],
    ['Sold', r.sold],
    ['Returned', r.returned],
    ['Lost', r.lost],
    ['Still out', r.stillOut.length],
    ['Sales (receipts)', r.salesCount],
    ['Revenue (₹)', rupees(r.revenueMinor)],
  ]);
  summary.addRow([]);
  summary.addRow(['Revenue by payment method (₹)']).font = { bold: true };
  for (const m of ['CASH', 'UPI', 'CARD', 'OTHER'] as PaymentMethod[]) summary.addRow([m, rupees(r.byPaymentMethod[m])]);
  summary.getColumn(1).font = { bold: true };

  const books = wb.addWorksheet('Books sent');
  books.columns = [
    { header: 'Code', key: 'code', width: 14 },
    { header: 'Title', key: 'title', width: 50 },
    { header: 'Outcome', key: 'outcome', width: 12 },
    { header: 'Sent at', key: 'out', width: 22 },
    { header: 'Returned at', key: 'in', width: 22 },
    { header: 'Sent by', key: 'by', width: 20 },
  ];
  books.getRow(1).font = { bold: true };
  for (const m of movements) {
    books.addRow({ code: m.copy.code, title: m.copy.title, outcome: m.outcome, out: m.checkedOutAt, in: m.checkedInAt ?? '', by: m.checkedOutBy });
  }

  const out = wb.addWorksheet('Still out');
  out.columns = [
    { header: 'Code', key: 'code', width: 14 },
    { header: 'Title', key: 'title', width: 50 },
    { header: 'Shelf location', key: 'loc', width: 18 },
    { header: 'Price (₹)', key: 'price', width: 12 },
  ];
  out.getRow(1).font = { bold: true };
  for (const b of r.stillOut) out.addRow({ code: b.code, title: b.title, loc: b.locationCode ?? '', price: rupees(b.sellingPriceMinor) });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
