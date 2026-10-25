import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string, poolSize = 10) {
  const pool = new pg.Pool({ connectionString: url, max: poolSize });
  const db: Db = drizzle(pool, { schema, casing: 'snake_case' });
  return { pool, db };
}

/** Either the pool or an open transaction. Inside a transaction always pass the `tx`: using the pool there can deadlock it. */
export type Q = Db | Tx;
