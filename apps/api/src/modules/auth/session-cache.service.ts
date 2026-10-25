import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { users } from '../../db/schema/index.js';

export type CachedUser = Pick<
  typeof users.$inferSelect,
  'id' | 'username' | 'displayName' | 'role' | 'isActive' | 'mustChangePassword' | 'tokenVersion'
>;

const TTL_MS = 30_000;

/** 30-second cache of the user row so the JWT guard does not hit the DB on every request. */
@Injectable()
export class SessionCache {
  private readonly cache = new Map<string, { user: CachedUser | null; expires: number }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async get(id: string): Promise<CachedUser | null> {
    const hit = this.cache.get(id);
    if (hit && hit.expires > Date.now()) return hit.user;
    const [row] = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.id, id));
    const user = row ?? null;
    this.cache.set(id, { user, expires: Date.now() + TTL_MS });
    return user;
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}
