import { Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { AuditService, presentAudit } from '../events/audit.service';
import { Idempotent, respond } from '../idempotency/idempotent.decorator';
import type { IdempotentRequest } from '../idempotency/idempotency.service';
import { CreditAccountsService } from './credit-accounts.service';

@ApiTags('credit accounts')
@ApiBearerAuth()
@Controller('credit-accounts')
export class CreditAccountsController {
  constructor(
    private readonly accounts: CreditAccountsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Open a secured credit account (card stays inactive until collateral is confirmed)',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async open(
    @CurrentPrincipal() principal: Principal,
    @Idempotent('credit-accounts.open') idem: IdempotentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.accounts.open(principal, idem));
  }

  @Get()
  @ApiOperation({ summary: 'List your credit accounts (ops: all accounts)' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.accounts.list(principal);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Credit account with limit, balances, available credit and card' })
  get(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(principal, id);
  }

  @Get(':id/activity')
  @ApiOperation({
    summary: 'Timeline of everything that happened on the account (from the audit trail)',
  })
  async activity(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const account = await this.accounts.get(principal, id); // access check
    const entries = await this.audit.list({ creditAccountId: account.id }, 100);
    return entries.map((entry) => {
      const { seq, occurredAt, actor, action, entityType, entityId, data } = presentAudit(entry);
      return { seq, occurredAt, actor: { type: actor.type }, action, entityType, entityId, data };
    });
  }
}
