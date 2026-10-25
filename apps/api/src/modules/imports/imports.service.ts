import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import {
  IMPORT_COLUMNS, IMPORT_MAX_BYTES,
  type CatalogLookupResult, type CommitImportBody, type ImportJobDto, type ImportMessage, type ImportRowDto, type ImportStatus,
  type ListImportRowsQuery, type Page, type PatchImportRowBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { EventBus } from '../../common/events/event-bus.js';
import type { Db } from '../../db/client.js';
import { DB, TxRunner, type AfterCommit } from '../../db/db.module.js';
import { copies, genres, importJobs, importRows } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { locationOf, selectCopies } from '../copies/copy-queries.js';
import { CopiesService } from '../copies/copies.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ImportFileError, parseImportWorkbook, type RawRow } from './import-parse.js';
import {
  buildGenreIndex, ROW_DUPLICATE_WARNING, validateImportRow, wantsLookup, type GenreIndex, type NormalizedImportRow,
} from './import-row.js';
import { buildImportTemplate } from './import-template.js';

export const IMPORT_VALIDATE_JOB = 'import.validate';
export const IMPORT_COMMIT_JOB = 'import.commit';
const CHUNK = 100;
const LOOKUP_CONCURRENCY = 4;

type JobRow = typeof importJobs.$inferSelect;
type RowRow = typeof importRows.$inferSelect;

@Injectable()
export class ImportsService implements OnModuleInit {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CopiesService) private readonly copies: CopiesService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.jobs.register<{ jobId: string }>(IMPORT_VALIDATE_JOB, (d) => this.validate(d.jobId), { retryLimit: 1, retryBackoff: false, retryDelay: 5 });
    // resumable: rows commit in chunks, so a retry continues with the first uncommitted row
    this.jobs.register<{ jobId: string }>(IMPORT_COMMIT_JOB, (d) => this.commit(d.jobId), { retryLimit: 3, retryBackoff: true, retryDelay: 10 });
  }

  // ───────────────────────── DTOs ─────────────────────────

  private async counts(jobId: string) {
    const rows = await this.db
      .select({ status: importRows.status, n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .groupBy(importRows.status);
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    return {
      total: rows.reduce((a, r) => a + r.n, 0),
      valid: n('VALID'), warning: n('WARNING'), error: n('ERROR'), committed: n('COMMITTED'), skipped: n('SKIPPED'),
    };
  }

  private toJobDto(j: JobRow, processedRows?: number): ImportJobDto {
    return {
      id: j.id, originalName: j.originalName, status: j.status, totalRows: j.totalRows, validRows: j.validRows,
      warningRows: j.warningRows, errorRows: j.errorRows, copiesCreated: j.copiesCreated,
      processedRows: processedRows ?? (j.status === 'READY' ? j.totalRows : 0),
      errorMessage: j.errorMessage, createdAt: j.createdAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null,
    };
  }

  private async getJob(id: string): Promise<JobRow> {
    const [j] = await this.db.select().from(importJobs).where(eq(importJobs.id, id));
    if (!j) throw new AppError('NOT_FOUND', 'Import not found');
    return j;
  }

  async get(id: string): Promise<ImportJobDto> {
    const j = await this.getJob(id);
    if (j.status === 'COMMITTING' || j.status === 'COMPLETED') {
      const c = await this.counts(id);
      return this.toJobDto(j, c.committed + c.skipped);
    }
    return this.toJobDto(j);
  }

  async list(page: number, pageSize: number): Promise<Page<ImportJobDto>> {
    const [items, [{ n } = { n: 0 }]] = await Promise.all([
      this.db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(importJobs),
    ]);
    return { items: items.map((j) => this.toJobDto(j)), page, pageSize, total: n };
  }

  private toRowDto(r: RowRow, genreOf?: (id: string) => string | null): ImportRowDto {
    const nz = r.normalized as NormalizedImportRow | null;
    return {
      id: r.id, rowNumber: r.rowNumber, status: r.status, raw: r.raw as Record<string, string>,
      messages: r.messages as ImportMessage[],
      preview: nz
        ? {
            title: nz.title?.title ?? (r.raw as RawRow).title ?? (r.raw as RawRow).isbn ?? '',
            authors: nz.title?.authors ?? [],
            genreId: nz.title?.genreId ?? null,
            condition: nz.copy.condition,
            sellingPriceMinor: nz.copy.sellingPriceMinor,
            quantity: nz.quantity,
            existingTitle: Boolean(nz.titleId),
            lookup: nz.lookup,
          }
        : null,
      createdCopyIds: r.createdCopyIds,
      ...(genreOf ? {} : {}),
    };
  }

  async rows(jobId: string, q: ListImportRowsQuery): Promise<Page<ImportRowDto>> {
    await this.getJob(jobId);
    const where = and(eq(importRows.jobId, jobId), q.status ? eq(importRows.status, q.status) : undefined);
    const [items, [{ n } = { n: 0 }]] = await Promise.all([
      this.db.select().from(importRows).where(where).orderBy(asc(importRows.rowNumber)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(importRows).where(where),
    ]);
    return { items: items.map((r) => this.toRowDto(r)), page: q.page, pageSize: q.pageSize, total: n };
  }

  async template(): Promise<Buffer> {
    const gs = await this.db.select({ name: genres.name, code: genres.code }).from(genres).where(eq(genres.isActive, true)).orderBy(asc(genres.sortOrder));
    return buildImportTemplate(gs);
  }

  private emit(job: Pick<JobRow, 'id' | 'createdById' | 'status' | 'totalRows'>, processedRows: number) {
    this.events.publish({
      name: 'import.updated',
      payload: { jobId: job.id, status: job.status, processedRows, totalRows: job.totalRows },
      rooms: [`user:${job.createdById}`],
    });
  }

  // ───────────────────────── upload ─────────────────────────

  async upload(actorId: string, file: { originalname: string; buffer: Buffer; size: number }): Promise<{ jobId: string }> {
    if (file.size > IMPORT_MAX_BYTES) throw new AppError('VALIDATION_FAILED', 'The file is larger than 10 MB');
    if (file.buffer.length < 4 || file.buffer.readUInt32LE(0) !== 0x04034b50) throw new AppError('VALIDATION_FAILED', 'Upload an .xlsx Excel file (use the template)');
    const [job] = await this.db
      .insert(importJobs)
      .values({ fileKey: 'pending', originalName: file.originalname.slice(0, 200), createdById: actorId })
      .returning();
    const key = `imports/${job!.id}.xlsx`;
    await this.storage.put(key, file.buffer);
    await this.db.update(importJobs).set({ fileKey: key }).where(eq(importJobs.id, job!.id));
    await this.jobs.send(IMPORT_VALIDATE_JOB, { jobId: job!.id });
    return { jobId: job!.id };
  }

  // ───────────────────────── validate (worker) ─────────────────────────

  private async fail(job: JobRow, message: string) {
    await this.db.update(importJobs).set({ status: 'FAILED', errorMessage: message, completedAt: new Date() }).where(eq(importJobs.id, job.id));
    this.emit({ ...job, status: 'FAILED' }, 0);
  }

  async validate(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job.status !== 'UPLOADED' && job.status !== 'VALIDATING') return; // already handled
    await this.db.update(importJobs).set({ status: 'VALIDATING', errorMessage: null }).where(eq(importJobs.id, jobId));
    this.emit({ ...job, status: 'VALIDATING' }, 0);

    try {
      const file = await this.storage.get(job.fileKey);
      if (!file) return await this.fail(job, 'The uploaded file is missing from storage');
      const sheet = await parseImportWorkbook(file);

      const genreRows = await this.db.select({ id: genres.id, name: genres.name, code: genres.code }).from(genres).where(eq(genres.isActive, true));
      const index: GenreIndex = buildGenreIndex(genreRows);

      // one lookup per distinct ISBN, a few at a time (providers are rate-limited inside CatalogService)
      const wanted = [...new Set(sheet.rows.map((r) => wantsLookup(r.raw)).filter((x): x is string => Boolean(x)))];
      const lookups = new Map<string, CatalogLookupResult | 'FAILED'>();
      let done = 0;
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(LOOKUP_CONCURRENCY, wanted.length) }, async () => {
          while (cursor < wanted.length) {
            const isbn = wanted[cursor++]!;
            try {
              lookups.set(isbn, await this.catalog.lookup(isbn));
            } catch {
              lookups.set(isbn, 'FAILED');
            }
            if (++done % 25 === 0) this.emit({ ...job, status: 'VALIDATING', totalRows: sheet.rows.length }, done);
          }
        }),
      );

      const seen = new Map<string, number>();
      const records = sheet.rows.map(({ rowNumber, raw }) => {
        const isbn = wantsLookup(raw);
        const found = isbn ? lookups.get(isbn) : undefined;
        // CatalogService reports provider outages as a warning on a "not found" result rather than throwing
        const lookupFailed = found === 'FAILED' || Boolean(found && !found.found && found.warnings?.includes('EXTERNAL_LOOKUP_FAILED'));
        const res = validateImportRow(raw, { genres: index, lookup: found && found !== 'FAILED' ? found : null, lookupFailed });
        const messages = [...res.messages];
        let status = res.status;
        if (res.dedupeKey) {
          if (seen.has(res.dedupeKey)) {
            messages.push(ROW_DUPLICATE_WARNING);
            if (status === 'VALID') status = 'WARNING';
          } else seen.set(res.dedupeKey, rowNumber);
        }
        return { jobId, rowNumber, raw, normalized: res.normalized, messages, status } satisfies typeof importRows.$inferInsert;
      });

      await this.db.transaction(async (tx) => {
        await tx.delete(importRows).where(eq(importRows.jobId, jobId)); // idempotent on retry
        for (let i = 0; i < records.length; i += 500) await tx.insert(importRows).values(records.slice(i, i + 500));
        const count = (s: string) => records.filter((r) => r.status === s).length;
        await tx
          .update(importJobs)
          .set({ status: 'READY', totalRows: records.length, validRows: count('VALID'), warningRows: count('WARNING'), errorRows: count('ERROR') })
          .where(eq(importJobs.id, jobId));
      });
      this.emit({ ...job, status: 'READY', totalRows: records.length }, records.length);
    } catch (e) {
      if (e instanceof ImportFileError) return await this.fail(job, e.message);
      this.logger.error(`import.validate ${jobId}: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
      await this.fail(job, 'Something went wrong while checking the file. Please try again.');
      throw e;
    }
  }

  // ───────────────────────── fix-ups ─────────────────────────

  private async recount(jobId: string) {
    const c = await this.counts(jobId);
    await this.db.update(importJobs).set({ validRows: c.valid, warningRows: c.warning, errorRows: c.error, totalRows: c.total }).where(eq(importJobs.id, jobId));
  }

  private async editableRow(jobId: string, rowId: string): Promise<{ job: JobRow; row: RowRow }> {
    const job = await this.getJob(jobId);
    if (job.status !== 'READY') throw new AppError('IMPORT_NOT_READY', 'Rows can only be edited while the import is waiting for review');
    const [row] = await this.db.select().from(importRows).where(and(eq(importRows.id, rowId), eq(importRows.jobId, jobId)));
    if (!row) throw new AppError('NOT_FOUND', 'Row not found');
    return { job, row };
  }

  async patchRow(jobId: string, rowId: string, body: PatchImportRowBody): Promise<ImportRowDto> {
    const { row } = await this.editableRow(jobId, rowId);
    if (row.status === 'COMMITTED') throw new AppError('CONFLICT', 'This row has already been imported');
    const raw: RawRow = { ...(row.raw as RawRow) };
    for (const [k, v] of Object.entries(body.fields)) {
      const text = v === null || v === undefined ? '' : String(v).trim();
      if (text) (raw as Record<string, string>)[k] = text;
      else delete (raw as Record<string, string>)[k];
    }
    const genreRows = await this.db.select({ id: genres.id, name: genres.name, code: genres.code }).from(genres).where(eq(genres.isActive, true));
    const isbn = wantsLookup(raw);
    let lookup: CatalogLookupResult | null = null;
    let failed = false;
    if (isbn) {
      try {
        lookup = await this.catalog.lookup(isbn);
        failed = !lookup.found && Boolean(lookup.warnings?.includes('EXTERNAL_LOOKUP_FAILED'));
      } catch {
        failed = true;
      }
    }
    const res = validateImportRow(raw, { genres: buildGenreIndex(genreRows), lookup, lookupFailed: failed });
    const [updated] = await this.db
      .update(importRows)
      .set({ raw, normalized: res.normalized, messages: res.messages, status: res.status })
      .where(eq(importRows.id, rowId))
      .returning();
    await this.recount(jobId);
    return this.toRowDto(updated!);
  }

  async skipRow(jobId: string, rowId: string): Promise<ImportRowDto> {
    const { row } = await this.editableRow(jobId, rowId);
    if (row.status === 'COMMITTED') throw new AppError('CONFLICT', 'This row has already been imported');
    const [updated] = await this.db.update(importRows).set({ status: 'SKIPPED' }).where(eq(importRows.id, row.id)).returning();
    await this.recount(jobId);
    return this.toRowDto(updated!);
  }

  // ───────────────────────── commit ─────────────────────────

  async requestCommit(actorId: string, jobId: string, body: CommitImportBody): Promise<ImportJobDto> {
    const job = await this.getJob(jobId);
    if (job.status !== 'READY') throw new AppError('IMPORT_NOT_READY', `This import is ${job.status.toLowerCase()}, not ready to commit`);
    const c = await this.counts(jobId);
    if (c.error > 0 && !body.skipErrors) {
      throw new AppError('IMPORT_NOT_READY', `${c.error} row(s) still have errors. Fix or skip them, or commit with skipErrors`, { errorRows: c.error });
    }
    if (c.valid + c.warning === 0) throw new AppError('IMPORT_NOT_READY', 'There are no valid rows to import');

    const claimed = await this.db
      .update(importJobs)
      .set({ status: 'COMMITTING' })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.status, 'READY')))
      .returning();
    if (!claimed.length) throw new AppError('IMPORT_NOT_READY', 'This import is already being committed');
    if (c.error > 0) {
      await this.db.update(importRows).set({ status: 'SKIPPED' }).where(and(eq(importRows.jobId, jobId), eq(importRows.status, 'ERROR')));
      await this.recount(jobId);
    }
    await this.audit.record(this.db, { actorId, action: 'import.commit', entityType: 'import', entityId: jobId, after: { rows: c.valid + c.warning, skippedErrors: body.skipErrors ? c.error : 0 } });
    await this.jobs.send(IMPORT_COMMIT_JOB, { jobId });
    this.emit({ ...claimed[0]!, status: 'COMMITTING' }, 0);
    return this.get(jobId);
  }

  /** Worker: creates the copies in chunks of 100 rows, one transaction each. Safe to re-run after a crash. */
  async commit(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job.status !== 'COMMITTING') return;
    let created = job.copiesCreated;
    for (;;) {
      const batch = await this.db
        .select()
        .from(importRows)
        .where(and(eq(importRows.jobId, jobId), inArray(importRows.status, ['VALID', 'WARNING'])))
        .orderBy(asc(importRows.rowNumber))
        .limit(CHUNK);
      if (!batch.length) break;

      created += await this.txr.run(async (tx, afterCommit: AfterCommit) => {
        let made = 0;
        for (const row of batch) {
          const nz = row.normalized as NormalizedImportRow;
          const later: Array<() => void | Promise<void>> = [];
          try {
            // a savepoint per row: one bad row becomes an ERROR row instead of losing the whole chunk
            const res = await tx.transaction((sp) =>
              this.copies.createWithTitle(
                sp,
                job.createdById,
                {
                  quantity: nz.quantity,
                  copy: nz.copy,
                  ...(nz.titleId
                    ? { titleId: nz.titleId }
                    : { title: { ...nz.title!, source: 'IMPORT' as const } }),
                },
                (cb) => later.push(cb),
              ),
            );
            later.forEach((cb) => afterCommit(cb));
            await tx.update(importRows).set({ status: 'COMMITTED', createdCopyIds: res.copies.map((c) => c.id) }).where(eq(importRows.id, row.id));
            made += res.copies.length;
          } catch (e) {
            this.logger.warn(`import ${jobId} row ${row.rowNumber} failed: ${e instanceof Error ? e.message : e}`);
            const message: ImportMessage = { level: 'error', field: 'row', message: `Could not create the copies: ${e instanceof AppError ? e.message : 'unexpected error'}` };
            await tx.update(importRows).set({ status: 'ERROR', messages: [...(row.messages as ImportMessage[]), message] }).where(eq(importRows.id, row.id));
          }
        }
        return made;
      });
      await this.db.update(importJobs).set({ copiesCreated: created }).where(eq(importJobs.id, jobId));
      const c = await this.counts(jobId);
      this.emit({ ...job, status: 'COMMITTING', totalRows: c.total }, c.committed + c.skipped + c.error);
    }

    await this.recount(jobId);
    await this.db.update(importJobs).set({ status: 'COMPLETED', completedAt: new Date(), copiesCreated: created }).where(eq(importJobs.id, jobId));
    const c = await this.counts(jobId);
    this.emit({ ...job, status: 'COMPLETED', totalRows: c.total }, c.committed + c.skipped + c.error);
  }

  // ───────────────────────── result file ─────────────────────────

  async resultXlsx(jobId: string): Promise<Buffer> {
    const job = await this.getJob(jobId);
    const rows = await this.db.select().from(importRows).where(eq(importRows.jobId, jobId)).orderBy(asc(importRows.rowNumber));
    const allIds = rows.flatMap((r) => r.createdCopyIds);
    const made = allIds.length ? await selectCopies(this.db).where(inArray(copies.id, allIds)) : [];
    const byId = new Map(made.map((m) => [m.copy.id, m]));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Result');
    ws.columns = [
      { header: 'row', key: 'row', width: 6 },
      { header: 'status', key: 'status', width: 12 },
      ...IMPORT_COLUMNS.map((c) => ({ header: c, key: c, width: 18 })),
      { header: 'created codes', key: 'codes', width: 34 },
      { header: 'locations', key: 'locs', width: 34 },
      { header: 'messages', key: 'msgs', width: 60 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const created = r.createdCopyIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      ws.addRow({
        row: r.rowNumber, status: r.status, ...(r.raw as Record<string, string>),
        codes: created.map((c) => c.copy.code).join(', '),
        locs: created.map((c) => locationOf(c) ?? 'UNSHELVED').join(', '),
        msgs: (r.messages as ImportMessage[]).map((m) => `${m.level.toUpperCase()} ${m.field}: ${m.message}`).join(' | '),
      });
      if (r.status === 'ERROR') ws.lastRow!.font = { color: { argb: 'FFB00020' } };
    }
    void job;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

export type { ImportStatus };
