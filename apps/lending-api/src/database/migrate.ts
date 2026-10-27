import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

/** Same relative depth from src/database and dist/database: <repo>/db/migrations. */
export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? resolve(__dirname, '../../../../db/migrations');

/**
 * Applies pending migrations. Forward-only by design: a financial schema is never rolled
 * back, it is corrected by a new migration. An advisory lock makes concurrent runs
 * (e.g. two deploy tasks) safe.
 */
export async function runMigrations(databaseUrl: string, migrationsFolder = MIGRATIONS_DIR) {
  const client = new Client({ connectionString: databaseUrl, application_name: 'migrations' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['acme-credit:migrations']);
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end(); // releases the advisory lock
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url).then(
    () => console.log(`migrations applied from ${MIGRATIONS_DIR}`),
    (error: unknown) => {
      console.error('migration failed', error);
      process.exit(1);
    },
  );
}
