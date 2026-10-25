import ExcelJS from 'exceljs';
import { BookCondition, IMPORT_COLUMNS, IMPORT_MAX_ROWS, type ImportColumn } from '@bookstall/shared';

const HEADERS: Record<ImportColumn, { width: number; note: string }> = {
  isbn: { width: 18, note: 'ISBN-10 or ISBN-13, hyphens allowed. Fills in title, author, summary, cover and genre automatically.' },
  title: { width: 40, note: 'Required if there is no ISBN (or it is not found online).' },
  authors: { width: 28, note: 'Separate several authors with ;' },
  genre: { width: 26, note: 'A genre name or code from the Genres sheet. Optional when an ISBN lets us suggest one.' },
  condition: { width: 14, note: 'Required. NEW, LIKE_NEW, VERY_GOOD, GOOD, FAIR or POOR.' },
  original_price: { width: 14, note: 'MRP in rupees, e.g. 399 or 399.50. Optional.' },
  selling_price: { width: 14, note: 'Required. Our price in rupees.' },
  quantity: { width: 10, note: 'Identical copies (same condition and price), 1–200. Default 1.' },
  publisher: { width: 22, note: 'Optional.' },
  published_year: { width: 14, note: 'Optional, e.g. 2015.' },
  language: { width: 12, note: 'Optional: en, hi, … or a name like Hindi.' },
  summary: { width: 40, note: 'Optional.' },
  cover_url: { width: 30, note: 'Optional http(s) link to a cover image.' },
  donor: { width: 18, note: 'Optional: who donated the book.' },
  notes: { width: 24, note: 'Optional internal notes.' },
};

export async function buildImportTemplate(genres: Array<{ name: string; code: string }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bookstall';

  const books = wb.addWorksheet('Books', { views: [{ state: 'frozen', ySplit: 1 }] });
  books.columns = IMPORT_COLUMNS.map((key) => ({ header: key, key, width: HEADERS[key].width }));
  const head = books.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF8' } };
  IMPORT_COLUMNS.forEach((key, i) => {
    const required = key === 'condition' || key === 'selling_price';
    books.getCell(1, i + 1).note = HEADERS[key].note;
    if (required) books.getCell(1, i + 1).font = { bold: true, color: { argb: 'FFB00020' } };
  });

  const genreSheet = wb.addWorksheet('Genres');
  genreSheet.columns = [{ header: 'Genre name', key: 'name', width: 38 }, { header: 'Code', key: 'code', width: 8 }];
  genreSheet.getRow(1).font = { bold: true };
  for (const g of genres) genreSheet.addRow(g);

  const last = Math.min(IMPORT_MAX_ROWS + 1, 2000);
  const colLetter = (key: ImportColumn) => books.getColumn(key).letter;
  for (let r = 2; r <= last; r++) {
    books.getCell(`${colLetter('condition')}${r}`).dataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'Condition',
      error: 'Pick one of the listed conditions', formulae: [`"${BookCondition.values.join(',')}"`],
    };
    books.getCell(`${colLetter('genre')}${r}`).dataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'Genre',
      error: 'Pick a genre from the Genres sheet', formulae: [`Genres!$A$2:$A$${Math.max(2, genres.length + 1)}`],
    };
  }

  const info = wb.addWorksheet('Instructions');
  info.columns = [{ width: 110 }];
  const lines = [
    'How to fill in the Books sheet',
    '',
    `• One row per group of identical copies. Up to ${IMPORT_MAX_ROWS} rows per file.`,
    '• Required: condition and selling_price, plus an ISBN or a title.',
    '• With an ISBN we look up the title, authors, summary, cover and a suggested genre online. Anything you type overrides it.',
    '• quantity creates several identical copies at once (same condition and price).',
    '• Prices are in rupees (399 or 399.50). No currency symbol needed.',
    '• You will see a preview with any problems before anything is saved, and you can fix or skip rows there.',
    '• After the import you can print all the new labels, sorted by shelf position.',
    '',
    'Columns:',
    ...IMPORT_COLUMNS.map((c) => `  ${c}: ${HEADERS[c].note}`),
  ];
  lines.forEach((l, i) => {
    const cell = info.getCell(i + 1, 1);
    cell.value = l;
    if (i === 0 || l === 'Columns:') cell.font = { bold: true, size: 13 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
