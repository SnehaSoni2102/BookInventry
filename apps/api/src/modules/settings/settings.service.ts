import { Inject, Injectable } from '@nestjs/common';
import type { ClientSettings, UpdateSettingsBody } from '@bookstall/shared';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Db, Q } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { settings } from '../../db/schema/index.js';
import { DEFAULT_SETTINGS } from '../../db/seed-data.js';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async getAll(q: Q = this.db): Promise<Record<string, unknown>> {
    const rows = await q.select().from(settings);
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  }

  async get<T>(key: string, q: Q = this.db): Promise<T> {
    return (await this.getAll(q))[key] as T;
  }

  /** Upserts the given (already validated) keys and records the change. Returns every setting. */
  async update(actorId: string, patch: UpdateSettingsBody, ip?: string): Promise<Record<string, unknown>> {
    await this.txr.run(async (tx) => {
      const before = await this.getAll(tx);
      for (const [key, value] of Object.entries(patch)) {
        await tx
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
      }
      await this.audit.record(tx, {
        actorId, action: 'settings.update', entityType: 'settings', entityId: Object.keys(patch).join(','), ip,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), after: patch,
      });
    });
    return this.getAll();
  }

  async clientSettings(): Promise<ClientSettings> {
    const s = await this.getAll();
    return {
      orgName: s['org.name'] as string,
      currency: s['org.currency'] as string,
      locale: s['org.locale'] as string,
      timezone: s['org.timezone'] as string,
      codePrefix: s['copy.codePrefix'] as string,
      defaultLabelTemplate: s['label.defaultTemplate'] as string,
      autoLockMinutes: s['session.autoLockMinutes'] as number,
      publicBaseUrl: this.env.PUBLIC_APP_URL,
    };
  }
}
