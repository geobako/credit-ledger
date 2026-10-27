import { Pool } from 'pg';
import { createDatabase, Database } from '../database/database';
import { TransactionManager } from '../database/transaction-manager';

export interface TestDatabase {
  db: Database;
  pool: Pool;
  tx: TransactionManager;
  close: () => Promise<void>;
}

/**
 * Tests share one database and never clean up (the ledger is append-only by design);
 * each test isolates itself by creating accounts with fresh random owner ids.
 */
export function connectTestDatabase(): TestDatabase {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  const db = createDatabase(pool);
  return { db, pool, tx: new TransactionManager(db), close: () => pool.end() };
}
