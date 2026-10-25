import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { EventBus } from '../../common/events/event-bus.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { copies, genres, shelfRows } from '../../db/schema/index.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const CAPACITY_CHECK_JOB = 'shelf.capacity.check';

export interface GenreFill {
  genreId: string;
  code: string;
  capacity: number;
  used: number;
  percentFull: number;
}

/** Tells admins (toast) when a genre's own rows are nearly full. Overflow rows are not counted. */
@Injectable()
export class ShelfCapacityService implements OnModuleInit {
  private readonly lastAlerted = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EventBus) private readonly events: EventBus,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(CAPACITY_CHECK_JOB, () => this.check().then(() => undefined), { retryLimit: 1 });
  }

  async fill(genreId?: string): Promise<GenreFill[]> {
    const rows = await this.db
      .select({
        genreId: shelfRows.genreId,
        code: genres.code,
        capacity: sql<number>`sum(${shelfRows.capacity})::int`,
        used: sql<number>`(SELECT count(*)::int FROM ${copies} c JOIN ${shelfRows} r2 ON r2.id = c.row_id
                          WHERE r2.genre_id = ${shelfRows.genreId} AND NOT r2.is_overflow AND r2.is_active)`,
      })
      .from(shelfRows)
      .innerJoin(genres, eq(genres.id, shelfRows.genreId))
      .where(and(eq(shelfRows.isActive, true), eq(shelfRows.isOverflow, false), genreId ? eq(shelfRows.genreId, genreId) : undefined))
      .groupBy(shelfRows.genreId, genres.code);
    return rows.map((r) => ({
      genreId: r.genreId!, code: r.code, capacity: r.capacity, used: r.used,
      percentFull: r.capacity ? Math.round((r.used / r.capacity) * 100) : 100,
    }));
  }

  /** Emits `shelf.space.low` for every genre at/over the threshold whose fill level grew since the last alert. */
  async check(genreId?: string): Promise<GenreFill[]> {
    const threshold = await this.settings.get<number>('shelf.lowSpaceThresholdPercent');
    const low = (await this.fill(genreId)).filter((f) => f.percentFull >= threshold);
    for (const f of low) {
      if ((this.lastAlerted.get(f.genreId) ?? -1) >= f.percentFull) continue;
      this.lastAlerted.set(f.genreId, f.percentFull);
      this.events.publish({ name: 'shelf.space.low', payload: { genreId: f.genreId, code: f.code, percentFull: f.percentFull }, rooms: ['role:admin'] });
    }
    return low;
  }
}
