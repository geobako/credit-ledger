import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuthorizationsService } from '../authorizations/authorizations.service';
import { CardsService } from '../cards/cards.service';
import { Money } from '../common/money/money';
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

class SimulatePurchaseDto {
  @ApiProperty({ example: '1250', description: 'Minor units (cents)' })
  @Matches(/^[1-9]\d{0,14}$/)
  amount!: string;

  @ApiProperty({ required: false, example: 'Blue Bottle Coffee' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  merchantName?: string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Capture immediately after approval',
  })
  @IsOptional()
  @IsBoolean()
  capture?: boolean;
}

/**
 * Payment-provider and card-network simulator (sandbox only). It produces exactly what the real provider would:
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
    private readonly cards: CardsService,
    private readonly authorizations: AuthorizationsService,
  ) {}

  private assertEnabled() {
    if (!this.env.SANDBOX_ENABLED) throw new NotFoundError('sandbox is disabled');
  }

  @Post('cards/:cardId/purchases')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Simulate a card purchase arriving from the network (optionally captured at once)',
  })
  async purchase(
    @CurrentPrincipal() principal: Principal,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: SimulatePurchaseDto,
  ) {
    this.assertEnabled();
    const card = await this.cards.findAccessible(principal, cardId);
    const decision = await this.authorizations.authorize({
      networkTransactionId: `sbx_${randomUUID()}`,
      cardToken: card.networkToken,
      amount: Money.of(dto.amount, 'USD'),
      merchantName: dto.merchantName ?? 'Sandbox Merchant',
    });
    const captured =
      decision.approved && dto.capture && decision.authorizationId
        ? await this.authorizations.capture(decision.authorizationId)
        : null;
    return { decision, captured };
  }

  @Post('authorizations/:id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulate the network capturing (settling) an authorization' })
  async capture(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    await this.assertCanSeeAuthorization(principal, id);
    return this.authorizations.capture(id);
  }

  @Post('authorizations/:id/reverse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulate the merchant reversing an authorization' })
  async reverse(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    await this.assertCanSeeAuthorization(principal, id);
    return this.authorizations.reverse(id);
  }

  private async assertCanSeeAuthorization(principal: Principal, id: string) {
    const auth = await this.authorizations.get(id);
    await this.accounts.findAccessible(this.db, principal, auth.creditAccountId);
  }

  @Post('payments/:reference/settle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulate the payment provider settling a collateral transfer' })
  async settle(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: SettlePaymentDto,
  ) {
    this.assertEnabled();
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
