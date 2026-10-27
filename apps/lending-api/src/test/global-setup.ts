import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../database/migrate';

declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Integration tests run against a real, throwaway Postgres with the real migrations
 * (triggers included). Set TEST_DATABASE_URL to reuse an existing database instead.
 */
export default async function globalSetup() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const container = await new PostgreSqlContainer('postgres:17-alpine').start();
    globalThis.__PG_CONTAINER__ = container;
    url = container.getConnectionUri();
  }
  process.env.DATABASE_URL = url;
  await runMigrations(url);
}
