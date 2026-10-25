import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { externalLookupCache, idempotencyKeys } from '../../db/schema/index.js';
import { JobsService } from '../jobs/jobs.service.js';

export const CACHE_PURGE_JOB = 'cache.purge';
const DAY = 86_400_000;

@Injectable()
export class MaintenanceService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(CACHE_PURGE_JOB, () => this.purge().then(() => undefined), { retryLimit: 1 });
  }

  /** Called by the worker process only. */
  async schedule(): Promise<void> {
    await this.jobs.schedule(CACHE_PURGE_JOB, '0 3 * * 0'); // Sundays 03:00
    await this.jobs.schedule('shelf.capacity.check', '30 1 * * *'); // nightly
  }

  /** Lookup cache rows older than 90 days and idempotency keys older than 7 days. */
  async purge(now = new Date()): Promise<{ lookups: number; keys: number }> {
    const lookups = await this.db
      .delete(externalLookupCache)
      .where(lt(externalLookupCache.fetchedAt, new Date(now.getTime() - 90 * DAY)))
      .returning({ k: externalLookupCache.lookupKey });
    const keys = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, new Date(now.getTime() - 7 * DAY)))
      .returning({ k: idempotencyKeys.key });
    return { lookups: lookups.length, keys: keys.length };
  }
}
