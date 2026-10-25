import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { can, type LabelPdfQuery, type LabelQueueItem, type LabelQueueQuery, type LabelTemplate, type Page } from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/decorators/index.js';
import { ScopeService, type Scope } from '../../common/scope.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { bookTitles, copies, importRows } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { locationOf, selectCopies, type CopyRow } from '../copies/copy-queries.js';
import { SettingsService } from '../settings/settings.service.js';
import { renderLabels, type LabelData } from './label-render.js';
import { qrPayload, qrSvg } from './qr.js';

@Injectable()
export class LabelsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Managers may only (re)print labels for copies at their own stall. */
  private assertPrintable(scope: Scope, rows: CopyRow[]) {
    if (scope.kind === 'all') return;
    const bad = rows.filter((r) => r.copy.status !== 'AT_STALL' || !scope.stallId || r.copy.currentStallId !== scope.stallId);
    if (bad.length) {
      throw new AppError('COPY_NOT_AT_YOUR_STALL', 'You can only print labels for books at your stall', { codes: bad.map((b) => b.copy.code) });
    }
  }

  private async rowsFor(q: Pick<LabelPdfQuery, 'copyIds' | 'importJobId'>): Promise<CopyRow[]> {
    if (q.importJobId) {
      const ids = await this.db.execute<{ id: string }>(
        sql`SELECT unnest(created_copy_ids) AS id FROM ${importRows} WHERE job_id = ${q.importJobId}`,
      );
      const rows = ids.rows.length ? await selectCopies(this.db).where(inArray(copies.id, ids.rows.map((r) => r.id))) : [];
      // sorted by shelf position so stickers go on in the order volunteers walk the shelves
      return rows.sort((a, b) => (locationOf(a) ?? '~').localeCompare(locationOf(b) ?? '~'));
    }
    const ids = q.copyIds!;
    const rows = await selectCopies(this.db).where(inArray(copies.id, ids));
    const byId = new Map(rows.map((r) => [r.copy.id, r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new AppError('NOT_FOUND', 'Some copies were not found', { copyIds: missing });
    return ids.map((id) => byId.get(id)!);
  }

  async pdf(user: AuthUser, q: Pick<LabelPdfQuery, 'copyIds' | 'importJobId' | 'template' | 'startPosition'>): Promise<Buffer> {
    const rows = await this.rowsFor(q);
    this.assertPrintable(await this.scope.resolve(user), rows);
    const template = (q.template ?? (await this.settings.get<LabelTemplate>('label.defaultTemplate'))) as LabelTemplate;
    const titles = await this.db
      .select({ id: bookTitles.id, title: bookTitles.title, authors: bookTitles.authors })
      .from(bookTitles)
      .where(inArray(bookTitles.id, [...new Set(rows.map((r) => r.copy.titleId))]));
    const titleBy = new Map(titles.map((t) => [t.id, t]));
    const data: LabelData[] = rows.map((r) => ({
      code: r.copy.code,
      title: titleBy.get(r.copy.titleId)!.title,
      authors: titleBy.get(r.copy.titleId)!.authors,
      condition: r.copy.condition,
      sellingPriceMinor: r.copy.sellingPriceMinor,
      originalPriceMinor: r.copy.originalPriceMinor,
      locationCode: locationOf(r),
    }));
    return renderLabels(data, {
      template,
      startPosition: q.startPosition,
      publicBaseUrl: this.env.PUBLIC_APP_URL,
      orgName: await this.settings.get<string>('org.name'),
    });
  }

  async qrSvgFor(user: AuthUser, copyId: string): Promise<string> {
    const [row] = await selectCopies(this.db).where(eq(copies.id, copyId));
    if (!row) throw new AppError('NOT_FOUND', 'Copy not found');
    const scope = await this.scope.resolve(user);
    if (scope.kind === 'stall') this.assertPrintable(scope, [row]);
    return qrSvg(qrPayload(this.env.PUBLIC_APP_URL, row.copy.code));
  }

  async queue(user: AuthUser, q: LabelQueueQuery): Promise<Page<LabelQueueItem>> {
    const where = and(
      eq(copies.labelNeedsPrint, true),
      inArray(copies.status, ['IN_STOCK', 'AT_STALL']),
      q.createdBy === 'me' ? eq(copies.createdById, user.id) : undefined,
      q.importJobId
        ? sql`${copies.id} = ANY (SELECT unnest(created_copy_ids) FROM ${importRows} WHERE job_id = ${q.importJobId})`
        : undefined,
    );
    const [rows, [{ n } = { n: 0 }]] = await Promise.all([
      selectCopies(this.db).where(where).orderBy(desc(copies.createdAt), asc(copies.code)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(copies).where(where),
    ]);
    const titles = rows.length
      ? await this.db.select({ id: bookTitles.id, title: bookTitles.title, authors: bookTitles.authors }).from(bookTitles)
          .where(inArray(bookTitles.id, [...new Set(rows.map((r) => r.copy.titleId))]))
      : [];
    const titleBy = new Map(titles.map((t) => [t.id, t]));
    return {
      items: rows.map((r) => ({
        id: r.copy.id, code: r.copy.code, title: titleBy.get(r.copy.titleId)!.title, authors: titleBy.get(r.copy.titleId)!.authors,
        condition: r.copy.condition, sellingPriceMinor: r.copy.sellingPriceMinor, locationCode: locationOf(r),
        createdAt: r.copy.createdAt.toISOString(),
      })),
      page: q.page, pageSize: q.pageSize, total: n,
    };
  }

  /** Called by the client after the user confirms the print succeeded. */
  async markPrinted(user: AuthUser, copyIds: string[]): Promise<{ updated: number }> {
    if (!can(user, 'inventory.read')) throw new AppError('FORBIDDEN', 'You may not clear the print queue');
    return this.txr.run(async (tx) => {
      const updated = await tx
        .update(copies)
        .set({ labelPrintedAt: new Date(), labelNeedsPrint: false })
        .where(inArray(copies.id, copyIds))
        .returning({ id: copies.id });
      await this.audit.record(tx, { actorId: user.id, action: 'label.printed', entityType: 'copy', entityId: 'batch', after: { copyIds: updated.map((u) => u.id) } });
      return { updated: updated.length };
    });
  }
}
