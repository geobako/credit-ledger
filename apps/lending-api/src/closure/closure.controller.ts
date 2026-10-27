import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { Idempotent, respond } from '../idempotency/idempotent.decorator';
import type { IdempotentRequest } from '../idempotency/idempotency.service';
import { ClosureReason, ClosureService } from './closure.service';

class CloseAccountDto {
  @ApiProperty({
    enum: ['CUSTOMER_REQUEST', 'CHARGE_OFF'],
    default: 'CUSTOMER_REQUEST',
    required: false,
  })
  @IsOptional()
  @IsIn(['CUSTOMER_REQUEST', 'CHARGE_OFF'])
  reason?: ClosureReason;
}

@ApiTags('closure')
@ApiBearerAuth()
@Controller('credit-accounts/:accountId/closure')
export class ClosureController {
  constructor(private readonly closure: ClosureService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Close the account: collateral is returned, or applied to any balance first (charge-off: ops only)',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async close(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CloseAccountDto,
    @Idempotent('credit-accounts.close') idem: IdempotentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      await this.closure.close(principal, accountId, dto.reason ?? 'CUSTOMER_REQUEST', idem),
    );
  }

  @Get()
  @ApiOperation({ summary: 'How the account was settled at closure' })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.closure.get(principal, accountId);
  }
}
