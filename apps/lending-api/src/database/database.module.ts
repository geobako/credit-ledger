import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { ENV, Env } from '../config/env';
import { Metrics } from '../metrics/metrics';
import { createDatabase, Database } from './database';
import { TransactionManager } from './transaction-manager';

export const DB = Symbol('DB');
const POOL = Symbol('POOL');

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Pool({
          connectionString: env.DATABASE_URL,
          max: env.DATABASE_POOL_MAX,
          application_name: 'lending-api',
        }),
    },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool) => createDatabase(pool) },
    {
      provide: TransactionManager,
      inject: [DB, Metrics],
      useFactory: (db: Database, metrics: Metrics) =>
        new TransactionManager(db, (code) => metrics.transactionRetries.inc({ code })),
    },
  ],
  exports: [DB, TransactionManager],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
