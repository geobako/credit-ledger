import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { AmountDto } from '../common/money/amount.dto';
import { Money } from '../common/money/money';
import { Idempotent, respond } from '../idempotency/idempotent.decorator';
import type { IdempotentRequest } from '../idempotency/idempotency.service';
import { RepaymentsService } from './repayments.service';

@ApiTags('repayments')
@ApiBearerAuth()
@Controller('credit-accounts/:accountId/repayments')
export class RepaymentsController {
  constructor(private readonly repayments: RepaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a repayment (at most the outstanding balance); returns payment instructions',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: AmountDto,
    @Idempotent('repayments.create') idem: IdempotentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const amount = Money.of(dto.amount, dto.currency ?? 'USD');
    return respond(res, await this.repayments.create(principal, accountId, amount, idem));
  }

  @Get()
  @ApiOperation({ summary: 'Repayments of a credit account' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.repayments.list(principal, accountId);
  }
}
