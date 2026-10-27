import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { ENV, Env } from '../config/env';
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
      inject: [DB],
      useFactory: (db: Database) => new TransactionManager(db),
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
