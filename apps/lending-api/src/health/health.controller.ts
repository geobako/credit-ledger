import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Kysely, sql } from 'kysely';
import { DB } from '../database/database.module';
import { Database } from '../database/schema';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: safe to receive traffic only when the database answers. */
  @Get('ready')
  async ready() {
    try {
      await sql`select 1`.execute(this.db);
      return { status: 'ready', checks: { database: 'up' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { database: 'down' },
      });
    }
  }
}
