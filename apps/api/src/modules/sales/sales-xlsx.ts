import ExcelJS from 'exceljs';
import type { SaleDto } from '@bookstall/shared';

export async function renderSalesXlsx(rows: SaleDto[], tz: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bookstall';
  const rupees = (m: number) => m / 100;
  const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: tz });

  const s = wb.addWorksheet('Sales');
  s.columns = [
    { header: 'Receipt', key: 'receipt', width: 12 },
    { header: 'Date & time', key: 'at', width: 22 },
    { header: 'Sold at', key: 'label', width: 26 },
    { header: 'Seller', key: 'seller', width: 20 },
    { header: 'Items', key: 'items', width: 8 },
    { header: 'Total (₹)', key: 'total', width: 12 },
    { header: 'Payment', key: 'pay', width: 10 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Void reason', key: 'reason', width: 30 },
  ];
  s.getRow(1).font = { bold: true };
  for (const r of rows) {
    s.addRow({ receipt: r.receiptNo, at: when(r.soldAt), label: r.soldAtLabel, seller: r.seller.displayName, items: r.itemsCount, total: rupees(r.totalMinor), pay: r.paymentMethod, status: r.status, reason: r.voidReason ?? '' });
  }

  const i = wb.addWorksheet('Items');
  i.columns = [
    { header: 'Receipt', key: 'receipt', width: 12 },
    { header: 'Code', key: 'code', width: 14 },
    { header: 'Title', key: 'title', width: 50 },
    { header: 'Condition', key: 'cond', width: 12 },
    { header: 'List price (₹)', key: 'list', width: 14 },
    { header: 'Sold price (₹)', key: 'sold', width: 14 },
    { header: 'Status', key: 'status', width: 11 },
  ];
  i.getRow(1).font = { bold: true };
  for (const r of rows) for (const it of r.items) {
    i.addRow({ receipt: r.receiptNo, code: it.code, title: it.title, cond: it.condition, list: rupees(it.listPriceMinor), sold: rupees(it.soldPriceMinor), status: r.status });
  }
  // customer names/phones are deliberately not exported (privacy)
  return Buffer.from(await wb.xlsx.writeBuffer());
}
