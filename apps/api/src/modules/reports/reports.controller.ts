import { Controller, Get, Inject, StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { asc, inArray } from 'drizzle-orm';
import { RequirePermission } from '../../common/decorators/index.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles, copies, stalls } from '../../db/schema/index.js';
import { locationOf, selectCopies } from '../copies/copy-queries.js';

@Controller('reports')
export class ReportsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Everything that is physically in stock or out at a stall, one row per copy. */
  @Get('inventory.xlsx')
  @RequirePermission('report.read')
  async inventory() {
    const rows = await selectCopies(this.db).where(inArray(copies.status, ['IN_STOCK', 'AT_STALL'])).orderBy(asc(copies.code));
    const titles = await this.db.select().from(bookTitles);
    const titleBy = new Map(titles.map((t) => [t.id, t]));
    const stallBy = new Map((await this.db.select({ id: stalls.id, name: stalls.name }).from(stalls)).map((s) => [s.id, s.name]));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventory');
    ws.columns = [
      { header: 'Code', key: 'code', width: 14 }, { header: 'Title', key: 'title', width: 44 }, { header: 'Authors', key: 'authors', width: 28 },
      { header: 'ISBN', key: 'isbn', width: 16 }, { header: 'Genre', key: 'genre', width: 8 }, { header: 'Condition', key: 'cond', width: 12 },
      { header: 'MRP (₹)', key: 'mrp', width: 10 }, { header: 'Price (₹)', key: 'price', width: 10 }, { header: 'Status', key: 'status', width: 11 },
      { header: 'Shelf location', key: 'loc', width: 16 }, { header: 'At stall', key: 'stall', width: 20 }, { header: 'Added', key: 'added', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const t = titleBy.get(r.copy.titleId)!;
      ws.addRow({
        code: r.copy.code, title: t.title, authors: t.authors.join('; '), isbn: t.isbn13 ?? '', genre: r.genreCode, cond: r.copy.condition,
        mrp: r.copy.originalPriceMinor === null ? '' : r.copy.originalPriceMinor / 100, price: r.copy.sellingPriceMinor / 100,
        status: r.copy.status, loc: locationOf(r) ?? 'UNSHELVED', stall: r.copy.currentStallId ? (stallBy.get(r.copy.currentStallId) ?? '') : '',
        added: r.copy.createdAt.toISOString().slice(0, 10),
      });
    }
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="inventory.xlsx"',
    });
  }
}
