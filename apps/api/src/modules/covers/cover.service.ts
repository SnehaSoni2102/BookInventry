import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { AppError } from '../../common/app-error.js';
import { EventBus } from '../../common/events/event-bus.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles } from '../../db/schema/index.js';
import { JobsService } from '../jobs/jobs.service.js';
import { StorageService } from '../storage/storage.service.js';
import { safeFetchImage } from './safe-fetch.js';

export const COVER_FETCH_JOB = 'cover.fetch';
const MAX_DOWNLOAD = 5 * 1024 * 1024;

@Injectable()
export class CoverService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  onModuleInit() {
    // A missing cover is fine: 3 retries with backoff, then give up silently.
    this.jobs.register<{ titleId: string; url: string }>(
      COVER_FETCH_JOB,
      (d) => this.fetchAndStore(d.titleId, d.url),
      { retryLimit: 3, retryBackoff: true, retryDelay: 10 },
    );
  }

  enqueueFetch(titleId: string, url: string): Promise<void> {
    return this.jobs.send(COVER_FETCH_JOB, { titleId, url });
  }

  /** Re-encodes any decodable image to WebP 400 px and 160 px and records it on the title. */
  async processAndStore(titleId: string, input: Buffer, sourceUrl?: string): Promise<void> {
    let large: Buffer;
    let thumb: Buffer;
    try {
      const base = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
      large = await base.clone().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      thumb = await base.clone().resize({ width: 160, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    } catch {
      throw new AppError('VALIDATION_FAILED', 'That file is not a readable image');
    }
    await this.storage.put(`covers/${titleId}/400.webp`, large);
    await this.storage.put(`covers/${titleId}/160.webp`, thumb);
    await this.db
      .update(bookTitles)
      .set({ coverKey: `covers/${titleId}/400.webp`, ...(sourceUrl ? { coverSourceUrl: sourceUrl } : {}) })
      .where(eq(bookTitles.id, titleId));
    this.events.publish({ name: 'title.updated', payload: { titleId } });
  }

  /** The `cover.fetch` job. Throws on failure so pg-boss retries. */
  async fetchAndStore(titleId: string, url: string): Promise<void> {
    const [t] = await this.db.select({ coverKey: bookTitles.coverKey }).from(bookTitles).where(eq(bookTitles.id, titleId));
    if (!t || t.coverKey) return; // deleted, or somebody uploaded a cover meanwhile
    const bytes = await safeFetchImage(url, {
      maxBytes: MAX_DOWNLOAD,
      timeoutMs: 10_000,
      maxRedirects: 3,
      allowPrivate: this.env.ALLOW_PRIVATE_FETCH,
    });
    await this.processAndStore(titleId, bytes, url);
  }
}
