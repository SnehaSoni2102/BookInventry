import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { can, parseScan, type CopyAction, type CopyDetail, type ScanResolveResult } from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/decorators/index.js';
import { ScopeService } from '../../common/scope.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles, copies, stalls } from '../../db/schema/index.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { CopiesService } from '../copies/copies.service.js';
import { TitlesService } from '../titles/titles.service.js';

@Injectable()
export class ScanService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(CopiesService) private readonly copies: CopiesService,
    @Inject(TitlesService) private readonly titles: TitlesService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /** Actions are decided here, from permission × status × scope, so clients never guess. */
  async actionsFor(user: AuthUser, copy: CopyDetail): Promise<CopyAction[]> {
    const actions: CopyAction[] = [];
    const live = copy.status === 'IN_STOCK' || copy.status === 'AT_STALL';
    const atStall = copy.status === 'AT_STALL' && copy.stall;
    const myStallId = can(user, 'sale.create.stall') && !can(user, 'inventory.read') ? await this.scope.activeStallId(user.id) : null;

    if (copy.status === 'IN_STOCK' && can(user, 'sale.create.central')) actions.push({ action: 'SELL' });
    else if (atStall && can(user, 'sale.create.central')) {
      actions.push({ action: 'SELL', requiresConfirm: 'COPY_AT_STALL', stall: copy.stall! });
    } else if (atStall && myStallId && copy.stall!.id === myStallId) {
      const [s] = await this.db.select({ status: stalls.status }).from(stalls).where(eq(stalls.id, myStallId));
      if (s?.status === 'ACTIVE') actions.push({ action: 'SELL' });
    }

    if (copy.status === 'IN_STOCK' && can(user, 'stall.checkout')) actions.push({ action: 'CHECKOUT' });
    if (atStall && can(user, 'stall.checkin')) {
      actions.push({ action: 'CHECKIN', stall: copy.stall!, returnToLocation: copy.locationCode });
    }
    if (live && can(user, 'copy.update')) actions.push({ action: 'EDIT' });
    if (live && can(user, 'label.print') && (can(user, 'inventory.read') || (atStall && copy.stall!.id === myStallId))) {
      actions.push({ action: 'PRINT_LABEL' });
    }
    if (live && can(user, 'copy.writeoff')) actions.push({ action: 'WRITE_OFF' });
    return actions;
  }

  async resolve(user: AuthUser, value: string): Promise<ScanResolveResult> {
    const parsed = parseScan(value);
    const scope = await this.scope.resolve(user);

    if (parsed.kind === 'copy') {
      const [row] = await this.db
        .select({ copy: copies, title: bookTitles.title, authors: bookTitles.authors })
        .from(copies)
        .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
        .where(eq(copies.code, parsed.code));
      if (!row) throw new AppError('NOT_FOUND', `No book with code ${parsed.code}`);
      if (scope.kind === 'stall' && (row.copy.status !== 'AT_STALL' || !scope.stallId || row.copy.currentStallId !== scope.stallId)) {
        return {
          kind: 'copy',
          blocked: 'COPY_NOT_AT_YOUR_STALL',
          copy: { code: row.copy.code, title: row.title, authors: row.authors },
          actions: [],
        };
      }
      const copy = await this.copies.getById(row.copy.id, scope);
      return { kind: 'copy', copy, actions: await this.actionsFor(user, copy) };
    }

    if (parsed.kind === 'isbn') {
      const [t] = await this.db.select({ id: bookTitles.id }).from(bookTitles).where(eq(bookTitles.isbn13, parsed.isbn13));
      if (t) {
        return { kind: 'isbn', isbn13: parsed.isbn13, titleId: t.id, copyGroups: await this.titles.copyGroups(this.db, t.id, scope) };
      }
      if (can(user, 'copy.create')) {
        const lookup = await this.catalog.lookup(parsed.isbn13).catch(() => undefined);
        return { kind: 'isbn', isbn13: parsed.isbn13, ...(lookup ? { lookup } : {}) };
      }
      return { kind: 'isbn', isbn13: parsed.isbn13 };
    }

    return { kind: 'unknown', raw: parsed.raw };
  }
}
