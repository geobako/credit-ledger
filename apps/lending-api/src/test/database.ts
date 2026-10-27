import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../database/migrate';
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

/**
 * A brand-new, fully migrated database. For tests that assert facts about the whole system
 * (reconciliation, the audit chain) or deliberately corrupt data, and so must not share state.
 */
export async function createIsolatedDatabase(): Promise<string> {
  const adminUrl = process.env.DATABASE_URL!;
  const name = `isolated_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return url.toString();
}
