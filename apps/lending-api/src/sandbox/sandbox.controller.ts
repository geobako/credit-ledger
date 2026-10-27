import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { CollateralService } from '../collateral/collateral.service';
import { NotFoundError } from '../common/errors/domain-error';
import { ENV, Env } from '../config/env';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import { DB } from '../database/database.module';
import type { Database } from '../database/database';
import { signWebhook } from '../webhooks/webhook-signature';
import { WebhooksService } from '../webhooks/webhooks.service';

class SettlePaymentDto {
  @ApiProperty({ enum: ['succeeded', 'failed'] })
  @IsIn(['succeeded', 'failed'])
  outcome!: 'succeeded' | 'failed';

  @ApiProperty({
    required: false,
    description: 'Override the amount received (minor units) to simulate a mismatch',
  })
  @IsOptional()
  @Matches(/^\d{1,15}$/)
  amount?: string;
}

/**
 * Payment-provider simulator (sandbox only). It produces exactly what the real provider would:
 * a signed webhook event, fed through the same verification and processing path.
 */
@ApiTags('sandbox')
@ApiBearerAuth()
@Controller('sandbox')
export class SandboxController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    private readonly collateral: CollateralService,
    private readonly accounts: CreditAccountsService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Post('payments/:reference/settle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulate the payment provider settling a collateral transfer' })
  async settle(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: SettlePaymentDto,
  ) {
    if (!this.env.SANDBOX_ENABLED) throw new NotFoundError('sandbox is disabled');
    const deposit = await this.collateral.findByReference(reference);
    if (!deposit) throw new NotFoundError('unknown payment reference');
    await this.accounts.findAccessible(this.db, principal, deposit.creditAccountId);

    const event = {
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: dto.outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      data: {
        reference,
        amount: dto.amount ?? deposit.amount.toString(),
        currency: deposit.currency,
        ...(dto.outcome === 'failed' ? { failure_reason: 'INSUFFICIENT_FUNDS_AT_SOURCE' } : {}),
      },
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const ack = await this.webhooks.handlePaymentEvent(
      rawBody,
      signWebhook(this.env.WEBHOOK_SECRET, rawBody),
    );
    return { event, ack };
  }
}
