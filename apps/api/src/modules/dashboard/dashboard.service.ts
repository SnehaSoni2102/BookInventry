import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { can, type DashboardResponse } from '@bookstall/shared';
import type { AuthUser } from '../../common/decorators/index.js';
import { ScopeService } from '../../common/scope.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles, copies, stalls } from '../../db/schema/index.js';
import { SalesService } from '../sales/sales.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShelfCapacityService } from '../shelves/shelf-capacity.service.js';
import { StallsService } from '../stalls/stalls.service.js';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(StallsService) private readonly stalls: StallsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ShelfCapacityService) private readonly capacity: ShelfCapacityService,
    @Inject(ScopeService) private readonly scope: ScopeService,
  ) {}

  /** Each section is included only when the caller's permissions allow it. */
  async get(user: AuthUser): Promise<DashboardResponse> {
    const out: DashboardResponse = {};
    const tz = await this.settings.get<string>('org.timezone');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD in the NGO's time zone

    if (can(user, 'inventory.read')) {
      const [counts] = await this.db
        .select({
          inStock: sql<number>`count(*) FILTER (WHERE ${copies.status} = 'IN_STOCK')::int`,
          atStalls: sql<number>`count(*) FILTER (WHERE ${copies.status} = 'AT_STALL')::int`,
          unshelved: sql<number>`count(*) FILTER (WHERE ${copies.status} = 'IN_STOCK' AND ${copies.rowId} IS NULL)::int`,
          labelsPending: sql<number>`count(*) FILTER (WHERE ${copies.labelNeedsPrint} AND ${copies.status} IN ('IN_STOCK','AT_STALL'))::int`,
          writtenOff: sql<number>`count(*) FILTER (WHERE ${copies.status} = 'WRITTEN_OFF')::int`,
        })
        .from(copies);
      const [{ titles } = { titles: 0 }] = await this.db
        .select({ titles: sql<number>`count(DISTINCT ${bookTitles.id})::int` })
        .from(bookTitles)
        .innerJoin(copies, and(eq(copies.titleId, bookTitles.id), inArray(copies.status, ['IN_STOCK', 'AT_STALL'])));
      out.inventory = { titles, ...counts! };
    }

    if (can(user, 'sale.read.all')) {
      out.salesToday = await this.sales.summary(user, { groupBy: 'stall', from: today, to: today });
      out.recentSales = (await this.sales.list(user, { page: 1, pageSize: 10 })).items;
      out.activeStalls = await this.stalls.list({ status: 'ACTIVE' });
    } else if (can(user, 'stall.checkout') || can(user, 'stall.checkin')) {
      out.activeStalls = await this.stalls.list({ status: 'ACTIVE' });
    }
    if (can(user, 'shelf.manage')) {
      const low = await this.capacity.check();
      out.shelfAlerts = low.map((l) => ({ genreId: l.genreId, code: l.code, percentFull: l.percentFull }));
    }

    if (can(user, 'sale.create.stall') && !can(user, 'inventory.read')) {
      const stallId = await this.scope.activeStallId(user.id);
      const [stall] = stallId ? await this.db.select({ id: stalls.id, name: stalls.name, status: stalls.status }).from(stalls).where(and(eq(stalls.id, stallId), isNull(stalls.deletedAt))) : [];
      const [held] = stallId
        ? await this.db
            .select({ n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${copies.sellingPriceMinor}), 0)::int` })
            .from(copies)
            .where(and(eq(copies.currentStallId, stallId), eq(copies.status, 'AT_STALL')))
        : [];
      const mine = await this.sales.summary(user, { groupBy: 'day', from: today, to: today });
      out.myStall = {
        stall: stall ?? null,
        booksAtStall: held?.n ?? 0,
        valueAtStallMinor: held?.value ?? 0,
        today: { salesCount: mine.total.salesCount, itemsCount: mine.total.itemsCount, revenueMinor: mine.total.revenueMinor },
      };
    }
    return out;
  }
}
