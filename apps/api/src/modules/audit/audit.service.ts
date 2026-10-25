import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { ListAuditQuery, Page } from '@bookstall/shared';
import type { Db, Tx } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { auditLogs } from '../../db/schema/index.js';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Call inside the mutation's transaction so the audit row commits or rolls back with it. */
  async record(tx: Tx | Db, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
    });
  }

  async list(q: ListAuditQuery): Promise<Page<typeof auditLogs.$inferSelect>> {
    const where = and(
      q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
      q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
      q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined,
      q.action ? eq(auditLogs.action, q.action) : undefined,
      q.from ? gte(auditLogs.createdAt, q.from) : undefined,
      q.to ? lte(auditLogs.createdAt, q.to) : undefined,
    );
    const [items, [{ n } = { n: 0 }]] = await Promise.all([
      this.db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: n };
  }
}
