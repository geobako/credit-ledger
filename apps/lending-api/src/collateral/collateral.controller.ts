import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { Money } from '../common/money/money';
import { Idempotent, respond } from '../idempotency/idempotent.decorator';
import type { IdempotentRequest } from '../idempotency/idempotency.service';
import { CreateDepositDto } from './collateral.dto';
import { CollateralService } from './collateral.service';

@ApiTags('collateral')
@ApiBearerAuth()
@Controller('credit-accounts/:accountId/collateral-deposits')
export class CollateralController {
  constructor(private readonly collateral: CollateralService) {}

  @Post()
  @ApiOperation({ summary: 'Start a collateral deposit; returns payment instructions' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateDepositDto,
    @Idempotent('collateral-deposits.create') idem: IdempotentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const amount = Money.of(dto.amount, dto.currency ?? 'USD');
    return respond(res, await this.collateral.createDeposit(principal, accountId, amount, idem));
  }

  @Get()
  @ApiOperation({ summary: 'Collateral deposits of a credit account' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.collateral.list(principal, accountId);
  }
}
