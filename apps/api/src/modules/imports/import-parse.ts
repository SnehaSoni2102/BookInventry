import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, type ImportColumn } from '@bookstall/shared';

/** Header text → canonical column. Tolerant of case, spaces, underscores and common synonyms. */
const ALIASES: Record<string, ImportColumn> = {
  isbn: 'isbn', isbn13: 'isbn', isbn10: 'isbn',
  title: 'title', booktitle: 'title', name: 'title',
  authors: 'authors', author: 'authors',
  genre: 'genre', category: 'genre',
  condition: 'condition',
  originalprice: 'original_price', mrp: 'original_price', listprice: 'original_price',
  sellingprice: 'selling_price', price: 'selling_price', saleprice: 'selling_price',
  quantity: 'quantity', qty: 'quantity', copies: 'quantity',
  publisher: 'publisher',
  publishedyear: 'published_year', year: 'published_year',
  language: 'language', lang: 'language',
  summary: 'summary', description: 'summary',
  coverurl: 'cover_url', cover: 'cover_url', image: 'cover_url',
  donor: 'donor', donorname: 'donor',
  notes: 'notes', remarks: 'notes', comments: 'notes',
};

export class ImportFileError extends Error {}

export type RawRow = Partial<Record<ImportColumn, string>>;

export interface ParsedSheet {
  /** Original header text per canonical column, for the result file. */
  headers: Partial<Record<ImportColumn, string>>;
  rows: Array<{ rowNumber: number; raw: RawRow }>;
}

/** Plain text of any exceljs cell value (numbers keep their natural form: 399 → "399"). */
export function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
  if ('formula' in v || 'sharedFormula' in v) return cellText((v as { result?: ExcelJS.CellValue }).result);
  if ('hyperlink' in v) return String((v as { text?: unknown }).text ?? (v as { hyperlink: string }).hyperlink).trim();
  if ('error' in v) return '';
  return String(v).trim();
}

/** Reads the first worksheet. Throws ImportFileError with a message meant for the user. */
export async function parseImportWorkbook(buffer: Buffer): Promise<ParsedSheet> {
  // .xlsx is a zip archive
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new ImportFileError('That is not an .xlsx file');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as never);
  } catch {
    throw new ImportFileError('The file could not be read as an Excel workbook');
  }
  const ws = wb.worksheets.find((w) => w.name.toLowerCase() === 'books') ?? wb.worksheets[0];
  if (!ws) throw new ImportFileError('The workbook has no sheets');

  const headerRow = ws.getRow(1);
  const col = new Map<number, ImportColumn>();
  const headers: ParsedSheet['headers'] = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, n) => {
    const text = cellText(cell.value);
    const key = ALIASES[text.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (key && !headers[key]) {
      col.set(n, key);
      headers[key] = text;
    }
  });
  const missing = (['condition', 'selling_price'] as const).filter((c) => !headers[c]);
  if (!headers.isbn && !headers.title) missing.push('isbn' as never);
  if (missing.length) {
    throw new ImportFileError(`Missing column(s): ${[...new Set(missing)].join(', ')}. Download the template for the expected layout.`);
  }

  const rows: ParsedSheet['rows'] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: RawRow = {};
    let any = false;
    for (const [n, key] of col) {
      const text = cellText(row.getCell(n).value);
      if (text) {
        raw[key] = text;
        any = true;
      }
    }
    if (!any) continue; // blank line
    rows.push({ rowNumber: r, raw });
    if (rows.length > IMPORT_MAX_ROWS) throw new ImportFileError(`Too many rows: the limit is ${IMPORT_MAX_ROWS} per file`);
  }
  if (!rows.length) throw new ImportFileError('The sheet has no data rows');
  return { headers, rows };
}

export { IMPORT_COLUMNS };
