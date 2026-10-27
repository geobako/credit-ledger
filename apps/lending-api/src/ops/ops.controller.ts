import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import type { Database } from '../database/database';
import { DB } from '../database/database.module';
import { AuditService, presentAudit } from '../events/audit.service';
import { OutboxService } from '../events/outbox.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReconciliationService } from './reconciliation.service';

const limitPipe = new DefaultValuePipe(50);

/** Back-office views for operations staff. */
@ApiTags('operations')
@ApiBearerAuth()
@Roles('ops')
@Controller('ops')
export class OpsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Portfolio totals' })
  async overview() {
    const accounts = await this.db.execute<{ status: string; count: number }>(
      sql`SELECT status, count(*)::int AS count FROM credit_accounts GROUP BY status`,
    );
    const totals = await this.db.execute<Record<string, string>>(sql`
      SELECT coalesce(sum(credit_limit), 0)::text AS credit_limit,
             coalesce(sum(outstanding_balance), 0)::text AS outstanding,
             coalesce(sum(held_amount), 0)::text AS held
        FROM credit_accounts WHERE status = 'ACTIVE'`);
    const system = await this.db.execute<{ kind: string; balance: string }>(
      sql`SELECT kind, balance::text FROM ledger_accounts WHERE owner_id IS NULL AND currency = 'USD'`,
    );
    const money = (amount: string | undefined) => ({ amount: amount ?? '0', currency: 'USD' });
    return {
      accountsByStatus: Object.fromEntries(accounts.rows.map((r) => [r.status, r.count])),
      active: {
        creditLimit: money(totals.rows[0]?.credit_limit),
        outstanding: money(totals.rows[0]?.outstanding),
        held: money(totals.rows[0]?.held),
      },
      systemAccounts: Object.fromEntries(system.rows.map((r) => [r.kind, money(r.balance)])),
      outbox: await this.outbox.backlog(),
    };
  }

  @Get('reconciliation')
  @ApiOperation({ summary: 'Run reconciliation now (one consistent snapshot)' })
  reconcile() {
    return this.reconciliation.run();
  }

  @Get('audit')
  @ApiOperation({ summary: 'Audit trail, newest first' })
  @ApiQuery({ name: 'creditAccountId', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  async auditTrail(
    @Query('creditAccountId', new ParseUUIDPipe({ optional: true })) creditAccountId?: string,
    @Query('entityId') entityId?: string,
    @Query('limit', limitPipe, ParseIntPipe) limit = 50,
  ) {
    const entries = await this.audit.list({ creditAccountId, entityId }, Math.min(limit, 500));
    return entries.map(presentAudit);
  }

  @Get('audit/verify')
  @ApiOperation({ summary: 'Recompute the audit hash chain' })
  verifyAudit() {
    return this.audit.verify();
  }

  @Get('ledger/entries')
  @ApiOperation({ summary: 'Journal entries with their postings (ledger explorer)' })
  @ApiQuery({ name: 'creditAccountId', required: false })
  ledgerEntries(
    @Query('creditAccountId', new ParseUUIDPipe({ optional: true })) creditAccountId?: string,
    @Query('limit', limitPipe, ParseIntPipe) limit = 50,
  ) {
    return this.ledger.listEntries(this.db, {
      ownerId: creditAccountId,
      limit: Math.min(limit, 200),
    });
  }

  @Get('outbox')
  @ApiOperation({ summary: 'Domain events in the outbox' })
  @ApiQuery({ name: 'status', enum: ['pending', 'published'], required: false })
  async outboxEvents(@Query('status') status: 'pending' | 'published' = 'pending') {
    const events = await this.outbox.list(status === 'published' ? 'published' : 'pending');
    return events.map((e) => ({ ...e, seq: e.seq.toString() }));
  }
}
