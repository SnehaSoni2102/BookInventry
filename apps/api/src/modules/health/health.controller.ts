import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../common/decorators/index.js';
import { StorageService } from '../storage/storage.service.js';
import { DB } from '../../db/db.module.js';
import type { Db } from '../../db/client.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.db.execute(sql`SELECT 1`);
      const res = await this.db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
      if (!Number(res.rows[0]?.n)) throw new Error('no migrations applied');
      await this.storage.check();
    } catch (e) {
      throw new ServiceUnavailableException({ status: 'unavailable', reason: (e as Error).message });
    }
    return { status: 'ok' };
  }
}
