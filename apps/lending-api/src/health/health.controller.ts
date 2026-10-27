import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Database } from '../database/database';
import { DB } from '../database/database.module';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: safe to receive traffic only when the database answers. */
  @Get('ready')
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ready', checks: { database: 'up' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { database: 'down' },
      });
    }
  }
}
