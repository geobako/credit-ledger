import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { ENV, Env } from '../config/env';
import { Database } from './schema';

export const DB = Symbol('DB');

// Return BIGINT (int8) columns as strings so money never passes through a JS number.
types.setTypeParser(types.builtins.INT8, (value) => value);

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: new Pool({
              connectionString: env.DATABASE_URL,
              max: env.DATABASE_POOL_MAX,
              application_name: 'lending-api',
            }),
          }),
        }),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
