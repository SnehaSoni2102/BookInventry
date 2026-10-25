import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { IMPORT_COLUMNS, isbn13Checksum } from '@bookstall/shared';
import { auditLogs, bookTitles, copies, genres, importJobs, importRows, users } from '../src/db/schema/index.js';
import { TxRunner } from '../src/db/db.module.js';
import { ImportsService } from '../src/modules/imports/imports.service.js';
import { bearer, createTestApp, type TestApp } from './app-helper.js';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

let ctx: TestApp;
let admin: string;
let adminId: string;
let staff: string;
const g: Record<string, string> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

type Cells = Record<string, string | number>;
async function workbook(rows: Cells[], headers?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Books');
  const cols = headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  ws.addRow(cols);
  for (const r of rows) ws.addRow(cols.map((c) => r[c] ?? null));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Providers: the recorded fixture for one ISBN, generated books for 9780000…, misses otherwise. */
function stubProviders() {
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const isbn = /(?:ISBN:|isbn(?::|%3A)|isbn\/)(\d{10,13})/i.exec(url)?.[1];
    if (url.startsWith('https://openlibrary.org/api/books')) {
      if (isbn === '9780143127550') return new Response(fx('ol-books-9780143127550.json'));
      if (isbn?.startsWith('9780000')) {
        return json({ [`ISBN:${isbn}`]: { title: `Generated ${isbn}`, authors: [{ name: 'Gen Author' }], subjects: [{ name: 'Fiction' }], publishers: [{ name: 'GenPub' }], publish_date: '2011' } });
      }
      return json({});
    }
    if (url.startsWith('https://openlibrary.org/isbn/') || url.startsWith('https://openlibrary.org/works/')) return json({}, 404);
    if (url.startsWith('https://www.googleapis.com/books/')) return isbn === '9780143127550' ? new Response(fx('gb-isbn-9780143127550.json')) : json({ totalItems: 0 });
    throw new Error(`Unexpected outbound request: ${url}`);
  });
}
afterEach(() => vi.unstubAllGlobals());

const upload = (token: string, buf: Buffer, name = 'books.xlsx') =>
  ctx.http().post('/api/v1/imports').set(bearer(token)).attach('file', buf, { filename: name, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
const job = async (id: string) => (await ctx.http().get(`/api/v1/imports/${id}`).set(bearer(admin))).body;
const rowsOf = async (id: string, qs = '') => (await ctx.http().get(`/api/v1/imports/${id}/rows?pageSize=100&${qs}`).set(bearer(admin))).body;
const validated = async (buf: Buffer) => {
  const res = await upload(admin, buf);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await ctx.jobs.drain();
  return res.body.jobId as string;
};
const commit = (id: string, body: object = {}) => ctx.http().post(`/api/v1/imports/${id}/commit`).set(bearer(admin)).send(body);

beforeAll(async () => {
  ctx = await createTestApp();
  const login = await ctx.login('admin', 'Admin-Pass-1');
  admin = (
    await ctx.http().post('/api/v1/auth/change-password').set(bearer(login.body.accessToken))
      .send({ currentPassword: 'Admin-Pass-1', newPassword: 'Brand-New-Pass-9' })
  ).body.accessToken;
  adminId = (await ctx.t.db.select().from(users).where(eq(users.username, 'admin')))[0]!.id;
  staff = await ctx.userToken('staff1', 'INVENTORY_STAFF');
  for (const r of await ctx.t.db.select().from(genres)) g[r.code] = r.id;
});
afterAll(async () => {
  await ctx.close();
});

describe('template', () => {
  it('is an Excel file with dropdowns, a Genres sheet and instructions', async () => {
    const res = await ctx.http().get('/api/v1/imports/template.xlsx').set(bearer(admin)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Books', 'Genres', 'Instructions']);
    const books = wb.getWorksheet('Books')!;
    expect(books.getRow(1).values).toEqual([undefined, ...IMPORT_COLUMNS]);
    const letter = (key: string) => books.getColumn(IMPORT_COLUMNS.indexOf(key as never) + 1).letter;
    const cond = books.getCell(`${letter('condition')}2`).dataValidation;
    expect(cond).toMatchObject({ type: 'list', formulae: ['"NEW,LIKE_NEW,VERY_GOOD,GOOD,FAIR,POOR"'] });
    expect(books.getCell(`${letter('genre')}2`).dataValidation.formulae[0]).toMatch(/^Genres!\$A\$2:\$A\$28$/);
    expect(wb.getWorksheet('Genres')!.rowCount).toBe(28); // header + 27 genres
    expect((await ctx.http().get('/api/v1/imports/template.xlsx').set(bearer(staff))).status).toBe(403);
  });

  it('round-trips: a filled-in template is accepted', async () => {
    const tpl = await ctx.http().get('/api/v1/imports/template.xlsx').set(bearer(admin)).buffer(true).parse(binary);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as never);
    wb.getWorksheet('Books')!.addRow(['', 'Template Book', 'Some One', 'Fiction (General & Literary)', 'GOOD', 100, 60]);
    const id = await validated(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(await job(id)).toMatchObject({ status: 'READY', totalRows: 1, validRows: 1 });
  });
});

describe('upload and validation', () => {
  it('previews every row with its status and messages', async () => {
    stubProviders();
    const id = await validated(
      await workbook([
        { isbn: '978-0-14-312755-0', condition: 'good', selling_price: 150, quantity: 3 }, // lookup fills everything
        { title: 'Manual Book', authors: 'A; B', genre: 'Fiction (General & Literary)', condition: 'very good', original_price: 399, selling_price: 120 },
        { title: 'हिन्दी की किताब', genre: 'HIN', condition: 'fair', selling_price: 50, quantity: 2 },
        { isbn: '9780143127550', condition: 'GOOD', selling_price: 150 }, // duplicate of row 2
        { title: 'Broken', genre: 'FIC', condition: 'mint', selling_price: 'abc' },
        {}, // blank line is ignored
      ]),
    );
    const j = await job(id);
    expect(j).toMatchObject({ status: 'READY', totalRows: 5, validRows: 2, warningRows: 2, errorRows: 1, copiesCreated: 0, originalName: 'books.xlsx' });

    const { items, total } = await rowsOf(id);
    expect(total).toBe(5);
    expect(items.map((r: { rowNumber: number; status: string }) => [r.rowNumber, r.status])).toEqual([[2, 'WARNING'], [3, 'VALID'], [4, 'VALID'], [5, 'WARNING'], [6, 'ERROR']]);
    expect(items[0].preview).toMatchObject({ title: 'Everything I Never Told You', condition: 'GOOD', sellingPriceMinor: 15000, quantity: 3, lookup: 'OPEN_LIBRARY', existingTitle: false });
    expect(items[0].messages).toEqual([expect.objectContaining({ level: 'warning', field: 'genre' })]);
    expect(items[3].messages.map((m: { message: string }) => m.message)).toEqual(expect.arrayContaining([expect.stringContaining('Duplicate of an earlier row')]));
    expect(items[4].preview).toBeNull();
    expect(items[4].messages.filter((m: { level: string }) => m.level === 'error').map((m: { field: string }) => m.field).sort()).toEqual(['condition', 'selling_price']);

    expect((await rowsOf(id, 'status=ERROR')).items).toHaveLength(1);
    expect((await rowsOf(id, 'status=VALID')).total).toBe(2);
    expect((await ctx.http().get(`/api/v1/imports/${id}/rows?status=NOPE`).set(bearer(admin))).status).toBe(400);
    // nothing is created until commit
    expect(await ctx.t.db.select().from(copies)).toHaveLength(0);
  });

  it('notifies the uploader when the job changes', async () => {
    stubProviders();
    ctx.events.published.length = 0;
    const id = await validated(await workbook([{ title: 'Evented', genre: 'FIC', condition: 'good', selling_price: 10 }]));
    const mine = ctx.events.published.filter((e) => e.name === 'import.updated' && e.payload.jobId === id);
    expect(mine.map((e) => e.payload.status)).toEqual(['VALIDATING', 'READY']);
    expect(mine[0]!.rooms).toEqual([`user:${adminId}`]);
    expect(mine.at(-1)!.payload).toMatchObject({ totalRows: 1, processedRows: 1 });
  });

  it('accepts friendly header names', async () => {
    const id = await validated(await workbook([{ 'Book Title': 'Alias Book', Author: 'Z', Category: 'fic', Condition: 'Good', MRP: 200, 'Selling Price': 90, Qty: 2 }]));
    const { items } = await rowsOf(id);
    expect(items[0]).toMatchObject({ status: 'VALID', preview: { title: 'Alias Book', quantity: 2, sellingPriceMinor: 9000 } });
  });

  it('survives an unreachable catalogue: rows keep their typed data and the user is warned', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    const id = await validated(await workbook([{ isbn: '9780306406157', title: 'Typed Title', genre: 'FIC', condition: 'good', selling_price: 10 }]));
    const { items } = await rowsOf(id);
    expect(items[0].status).toBe('WARNING');
    expect(items[0].messages[0]).toMatchObject({ field: 'isbn', message: expect.stringContaining('lookup was unavailable') });
    expect(items[0].preview.title).toBe('Typed Title');
  });

  it('marks the job FAILED with a clear message for bad files', async () => {
    const notExcel = await upload(admin, Buffer.from('a,b,c\n1,2,3'), 'books.csv');
    expect(notExcel.status).toBe(400);

    const noCols = await validated(await workbook([{ foo: 'x', bar: 'y' }]));
    expect(await job(noCols)).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('Missing column') });

    const empty = await validated(await workbook([], ['isbn', 'condition', 'selling_price']));
    expect(await job(empty)).toMatchObject({ status: 'FAILED', errorMessage: 'The sheet has no data rows' });

    const many = await validated(await workbook(Array.from({ length: 5001 }, (_, i) => ({ title: `T${i}`, genre: 'FIC', condition: 'good', selling_price: 1 }))));
    expect(await job(many)).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('Too many rows') });

    const garbage = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not really a zip')]);
    const bad = await validated(garbage);
    expect(await job(bad)).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('could not be read') });

    expect((await ctx.http().post('/api/v1/imports').set(bearer(admin))).status).toBe(400);
    expect((await upload(staff, await workbook([{ title: 'x' }]))).status).toBe(403);
    expect((await ctx.http().get('/api/v1/imports').set(bearer(staff))).status).toBe(403);
  });

  it('lists import jobs, newest first', async () => {
    const list = await ctx.http().get('/api/v1/imports').set(bearer(admin));
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(3);
    const times = list.body.items.map((j: { createdAt: string }) => j.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });
});

describe('fixing rows and committing', () => {
  let id: string;
  let badRowId: string;

  it('blocks the commit while errors remain', async () => {
    stubProviders();
    id = await validated(
      await workbook([
        { isbn: '9780143127550', condition: 'good', selling_price: 150, quantity: 3 },
        { title: 'Manual Book', authors: 'A; B', genre: 'Fiction (General & Literary)', condition: 'very good', original_price: 399, selling_price: 120 },
        { title: 'हिन्दी की किताब', genre: 'HIN', condition: 'fair', selling_price: 50, quantity: 2 },
        { isbn: '9780143127550', condition: 'GOOD', selling_price: 150 },
        { title: 'Fixable', genre: 'FIC', condition: 'mint', selling_price: 'abc' },
      ]),
    );
    badRowId = (await rowsOf(id, 'status=ERROR')).items[0].id;
    const res = await commit(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'IMPORT_NOT_READY', details: { errorRows: 1 } });
    expect((await job(id)).status).toBe('READY');
  });

  it('lets the admin correct a row, which is validated again', async () => {
    const stillBad = await ctx.http().patch(`/api/v1/imports/${id}/rows/${badRowId}`).set(bearer(admin)).send({ fields: { condition: 'poor' } });
    expect(stillBad.body).toMatchObject({ status: 'ERROR' });
    const fixed = await ctx.http().patch(`/api/v1/imports/${id}/rows/${badRowId}`).set(bearer(admin)).send({ fields: { selling_price: '40', condition: 'poor' } });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ status: 'VALID', messages: [], preview: { condition: 'POOR', sellingPriceMinor: 4000 } });
    expect(await job(id)).toMatchObject({ validRows: 3, warningRows: 2, errorRows: 0 });
    expect((await ctx.http().patch(`/api/v1/imports/${id}/rows/${badRowId}`).set(bearer(admin)).send({ fields: {} })).status).toBe(400);
    expect((await ctx.http().patch(`/api/v1/imports/${id}/rows/${badRowId}`).set(bearer(admin)).send({ fields: { colour: 'red' } })).status).toBe(400);
  });

  it('commits asynchronously, in order, creating each row’s copies', async () => {
    const accepted = await commit(id);
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('COMMITTING');
    expect((await commit(id)).status).toBe(409); // already running

    await ctx.jobs.drain();
    expect(ctx.jobs.failures).toEqual([]);
    const j = await job(id);
    expect(j).toMatchObject({ status: 'COMPLETED', copiesCreated: 3 + 1 + 2 + 1 + 1, processedRows: 5, completedAt: expect.any(String) });

    const rows = await ctx.t.db.select().from(importRows).where(eq(importRows.jobId, id));
    expect(rows.every((r) => r.status === 'COMMITTED')).toBe(true);
    expect(rows.map((r) => r.createdCopyIds.length).sort()).toEqual([1, 1, 1, 2, 3]);

    // both ISBN rows share one title; copies of the same title with the same price are one group
    const [god] = await ctx.t.db.select().from(bookTitles).where(eq(bookTitles.isbn13, '9780143127550'));
    expect(god).toMatchObject({ source: 'IMPORT', title: 'Everything I Never Told You', genreId: g.MYS, language: 'en' });
    expect(god!.summary).toMatch(/New York Times/); // description came from Google Books
    const godCopies = await ctx.t.db.select().from(copies).where(eq(copies.titleId, god!.id));
    expect(godCopies).toHaveLength(4);
    expect(godCopies.every((c) => c.labelNeedsPrint && c.createdById === adminId && c.status === 'IN_STOCK')).toBe(true);
    expect(new Set(godCopies.map((c) => `${c.rowId}:${c.slotNumber}`)).size).toBe(4);

    const manual = (await ctx.t.db.select().from(bookTitles).where(eq(bookTitles.title, 'Manual Book')))[0]!;
    expect(manual).toMatchObject({ authors: ['A', 'B'], genreId: g.FIC });
    expect((await ctx.t.db.select().from(copies).where(eq(copies.titleId, manual.id)))[0]).toMatchObject({ condition: 'VERY_GOOD', sellingPriceMinor: 12000, originalPriceMinor: 39900 });

    const [log] = await ctx.t.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'import.commit'), eq(auditLogs.entityId, id)));
    expect(log!.after).toMatchObject({ rows: 5 });
    expect(ctx.jobs.pending).toEqual([]);
  });

  it('prints all the new labels in shelf order, and lists them in the label queue', async () => {
    const pdf = await ctx.http().get(`/api/v1/labels/pdf?importJobId=${id}&template=A4_24`).set(bearer(admin)).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const queue = await ctx.http().get(`/api/v1/labels/queue?importJobId=${id}&pageSize=100`).set(bearer(staff));
    expect(queue.body.total).toBe(8);
    expect((await ctx.http().get(`/api/v1/labels/pdf?importJobId=${crypto.randomUUID()}`).set(bearer(admin)).buffer(true).parse(binary)).status).toBe(200); // empty job → empty (one blank page) PDF
  });

  it('writes a result file with created codes and locations', async () => {
    const res = await ctx.http().get(`/api/v1/imports/${id}/result.xlsx`).set(bearer(admin)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const ws = wb.getWorksheet('Result')!;
    expect(ws.rowCount).toBe(6);
    const header = (ws.getRow(1).values as string[]).slice(1);
    expect(header.slice(0, 2)).toEqual(['row', 'status']);
    const first = ws.getRow(2);
    const col = (name: string) => header.indexOf(name) + 1;
    expect(first.getCell(col('status')).value).toBe('COMMITTED');
    expect(String(first.getCell(col('created codes')).value).split(', ')).toHaveLength(3);
    expect(String(first.getCell(col('locations')).value)).toMatch(/^[A-Z]{2,4}-[A-Z]\d{2}-\d{3}/);
  });

  it('refuses edits and a second commit once finished', async () => {
    expect((await ctx.http().patch(`/api/v1/imports/${id}/rows/${badRowId}`).set(bearer(admin)).send({ fields: { notes: 'x' } })).status).toBe(409);
    expect((await ctx.http().post(`/api/v1/imports/${id}/rows/${badRowId}/skip`).set(bearer(admin))).status).toBe(409);
    expect((await commit(id)).status).toBe(409);
  });
});

describe('skipping rows and errors', () => {
  it('commits good rows when errors are skipped explicitly', async () => {
    const id = await validated(
      await workbook([
        { title: 'Good One', genre: 'FIC', condition: 'good', selling_price: 10 },
        { title: 'Bad One', genre: 'FIC', condition: 'nope', selling_price: 10 },
        { title: 'Skip Me', genre: 'FIC', condition: 'good', selling_price: 10 },
        { title: 'Good Two', genre: 'FIC', condition: 'good', selling_price: 10, quantity: 2 },
      ]),
    );
    const skipRow = (await rowsOf(id)).items.find((r: { raw: { title: string } }) => r.raw.title === 'Skip Me');
    const skipped = await ctx.http().post(`/api/v1/imports/${id}/rows/${skipRow.id}/skip`).set(bearer(admin));
    expect(skipped.body.status).toBe('SKIPPED');
    expect(await job(id)).toMatchObject({ validRows: 2, errorRows: 1 });

    expect((await commit(id)).status).toBe(409);
    expect((await commit(id, { skipErrors: true })).status).toBe(202);
    await ctx.jobs.drain();
    expect(await job(id)).toMatchObject({ status: 'COMPLETED', copiesCreated: 3, errorRows: 0 });
    const titles = await ctx.t.db.select({ t: bookTitles.title }).from(bookTitles).where(inArray(bookTitles.title, ['Good One', 'Bad One', 'Skip Me', 'Good Two']));
    expect(titles.map((x) => x.t).sort()).toEqual(['Good One', 'Good Two']);
    const statuses = (await rowsOf(id)).items.map((r: { status: string }) => r.status);
    expect(statuses).toEqual(['COMMITTED', 'SKIPPED', 'SKIPPED', 'COMMITTED']);
  });

  it('refuses to commit when nothing is importable', async () => {
    const id = await validated(await workbook([{ title: 'Only Bad', genre: 'FIC', condition: 'nope', selling_price: 1 }]));
    expect((await commit(id, { skipErrors: true })).status).toBe(409);
    expect((await job(id)).status).toBe('READY');
  });

  it('only a READY import can be committed', async () => {
    const failed = await validated(await workbook([{ foo: 1 }]));
    expect((await commit(failed)).body.error.code).toBe('IMPORT_NOT_READY');
    expect((await commit(crypto.randomUUID())).status).toBe(404);
  });
});

describe('resilience', () => {
  it('resumes after a crash mid-commit without duplicating copies', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ title: `Resume Book ${String(i).padStart(3, '0')}`, genre: 'ROM', condition: 'good', selling_price: 10 + i }));
    const id = await validated(await workbook(rows));
    expect((await commit(id)).status).toBe(202);

    const txr = ctx.app.get(TxRunner);
    const real = txr.run.bind(txr);
    let calls = 0;
    const spy = vi.spyOn(txr, 'run').mockImplementation((fn) => (++calls === 2 ? Promise.reject(new Error('database went away')) : real(fn)));
    const svc = ctx.app.get(ImportsService);
    await expect(svc.commit(id)).rejects.toThrow('database went away');
    spy.mockRestore();

    const mid = await ctx.t.db.select({ s: importRows.status }).from(importRows).where(eq(importRows.jobId, id));
    expect(mid.filter((r) => r.s === 'COMMITTED')).toHaveLength(100); // the first chunk is durable
    expect((await job(id)).status).toBe('COMMITTING');

    await svc.commit(id); // what pg-boss does on retry
    expect(await job(id)).toMatchObject({ status: 'COMPLETED', copiesCreated: 250 });
    const made = await ctx.t.db.select({ id: copies.id }).from(copies).innerJoin(bookTitles, eq(bookTitles.id, copies.titleId)).where(eq(bookTitles.source, 'IMPORT'));
    expect(made.filter(Boolean).length).toBeGreaterThanOrEqual(250);
    const titles = await ctx.t.db.select({ t: bookTitles.title }).from(bookTitles).where(eq(bookTitles.genreId, g.ROM!));
    const resumed = titles.filter((x) => x.t.startsWith('Resume Book'));
    expect(resumed).toHaveLength(250); // each title exactly once
  });

  it('turns an unexpected failure on one row into an ERROR row without losing the rest of the chunk', async () => {
    const id = await validated(
      await workbook([
        { title: 'Chunk Ok A', genre: 'FIC', condition: 'good', selling_price: 10 },
        { title: 'Chunk Poison', genre: 'FIC', condition: 'good', selling_price: 10 },
        { title: 'Chunk Ok B', genre: 'FIC', condition: 'good', selling_price: 10 },
      ]),
    );
    // corrupt one row's stored genre so only that row's insert fails
    await ctx.t.db.execute(`UPDATE import_rows SET normalized = jsonb_set(normalized, '{title,genreId}', '"00000000-0000-0000-0000-000000000000"') WHERE job_id = '${id}' AND row_number = 3` as never);
    await commit(id);
    await ctx.jobs.drain();
    expect(await job(id)).toMatchObject({ status: 'COMPLETED', copiesCreated: 2 });
    const { items } = await rowsOf(id);
    expect(items.map((r: { status: string }) => r.status)).toEqual(['COMMITTED', 'ERROR', 'COMMITTED']);
    expect(items[1].messages.at(-1).message).toContain('Could not create the copies');
  });
});

describe('performance', () => {
  it('imports 1,000 rows (with catalogue lookups mocked) in well under 60 s', async () => {
    stubProviders();
    // plenty of room on the shelf for them
    const rack = await ctx.http().post('/api/v1/racks').set(bearer(admin)).send({ code: 'Z' });
    await ctx.http().post(`/api/v1/racks/${rack.body.id}/rows/bulk`).set(bearer(admin)).send({ count: 2, capacity: 999, genreId: g.FIC });
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const body = `9780000${String(i).padStart(5, '0')}`;
      const isbn = body + isbn13Checksum(body);
      return { isbn, condition: i % 2 ? 'good' : 'fair', selling_price: 50 + (i % 7), quantity: 1 };
    });
    const file = await workbook(rows);

    const t0 = Date.now();
    const id = await validated(file);
    const validateMs = Date.now() - t0;
    const j = await job(id);
    expect(j).toMatchObject({ status: 'READY', totalRows: 1000, errorRows: 0 });

    expect((await commit(id)).status).toBe(202);
    await ctx.jobs.drain();
    const totalMs = Date.now() - t0;
    expect(await job(id)).toMatchObject({ status: 'COMPLETED', copiesCreated: 1000 });
    console.info(`1,000-row import: validate ${validateMs} ms, total ${totalMs} ms`);
    expect(totalMs).toBeLessThan(60_000);
    const unshelved = await ctx.t.db.select({ id: copies.id }).from(copies).where(and(eq(copies.status, 'IN_STOCK'), eq(copies.labelNeedsPrint, true)));
    expect(unshelved.length).toBeGreaterThanOrEqual(1000);
  }, 120_000);
});

// keep imports referenced
void importJobs;
