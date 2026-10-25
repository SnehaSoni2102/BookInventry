import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { createDb, type Db, type Tx } from './client.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

/** Runs `fn` in a transaction, then runs callbacks queued with `afterCommit` (e.g. realtime emits). */
export type AfterCommit = (cb: () => void | Promise<void>) => void;

@Injectable()
export class TxRunner {
  constructor(@Inject(DB) private readonly db: Db) {}

  async run<T>(fn: (tx: Tx, afterCommit: AfterCommit) => Promise<T>): Promise<T> {
    const queue: Array<() => void | Promise<void>> = [];
    const result = await this.db.transaction((tx) => fn(tx, (cb) => queue.push(cb)));
    for (const cb of queue) {
      try {
        await cb();
      } catch {
        /* post-commit side effects must never fail the request */
      }
    }
    return result;
  }
}

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

const DB_HANDLE = Symbol('DB_HANDLE');

@Global()
@Module({
  providers: [
    { provide: DB_HANDLE, inject: [ENV], useFactory: (env: Env) => createDb(env.DATABASE_URL, 10) },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: ReturnType<typeof createDb>) => h.db },
    { provide: PG_POOL, inject: [DB_HANDLE], useFactory: (h: ReturnType<typeof createDb>) => h.pool },
    TxRunner,
    PoolCloser,
  ],
  exports: [DB, PG_POOL, TxRunner],
})
export class DbModule {}
