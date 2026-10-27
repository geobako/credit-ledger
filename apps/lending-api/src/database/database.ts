import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: the pool-backed database or an open transaction. */
export type Executor = Database | Transaction;

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}
