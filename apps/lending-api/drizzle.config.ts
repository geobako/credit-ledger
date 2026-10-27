import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: '../../db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://acme:acme@localhost:5433/acme_credit',
  },
  strict: true,
});
