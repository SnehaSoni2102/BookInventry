import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { can } from '@bookstall/shared';
import type { Db, Q } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { stallAssignments, stalls } from '../db/schema/index.js';
import type { AuthUser } from './decorators/index.js';

export type Scope =
  | { kind: 'all' }
  /** Stall managers only ever see copies AT_STALL at their own active stall. */
  | { kind: 'stall'; stallId: string | null };

@Injectable()
export class ScopeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** A manager's active stall id (assignment not ended, stall not deleted or closed). */
  async activeStallId(userId: string, q: Q = this.db): Promise<string | null> {
    const [row] = await q
      .select({ id: stalls.id })
      .from(stallAssignments)
      .innerJoin(stalls, eq(stalls.id, stallAssignments.stallId))
      .where(and(eq(stallAssignments.userId, userId), isNull(stallAssignments.unassignedAt), isNull(stalls.deletedAt)));
    return row?.id ?? null;
  }

  async resolve(user: AuthUser): Promise<Scope> {
    if (can(user, 'inventory.read')) return { kind: 'all' };
    if (can(user, 'inventory.read.stall')) return { kind: 'stall', stallId: await this.activeStallId(user.id) };
    return { kind: 'stall', stallId: null };
  }
}
