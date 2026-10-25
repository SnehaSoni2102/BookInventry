import { Global, Injectable, Module } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { AppError } from '../app-error.js';
import { idempotencyKeys } from '../../db/schema/index.js';

export type IdempotencyHandle<T> =
  | { replay: true; response: T }
  | { replay: false; complete: (response: T) => Promise<void> };

/**
 * Makes a retried mutation return the original result instead of repeating the work.
 * Must be called at the start of the mutation's transaction: a concurrent duplicate blocks on the
 * unique key until the first transaction commits, then replays its stored response.
 */
@Injectable()
export class IdempotencyService {
  async begin<T>(tx: Tx, scope: string, key: string, userId: string): Promise<IdempotencyHandle<T>> {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ scope, key, userId })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length) {
      return {
        replay: false,
        complete: async (response) => {
          await tx
            .update(idempotencyKeys)
            .set({ response: response as object })
            .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
        },
      };
    }
    const [row] = await tx
      .select({ response: idempotencyKeys.response, userId: idempotencyKeys.userId })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!row || row.response === null || row.userId !== userId) {
      // Same key reused by another user, or by a request that never completed.
      throw new AppError('CONFLICT', 'This request id (clientRef) was already used by a different request');
    }
    return { replay: true, response: row.response as T };
  }
}

@Global()
@Module({ providers: [IdempotencyService], exports: [IdempotencyService] })
export class IdempotencyModule {}
