import { Module } from '@nestjs/common';
import { AuthorizationsModule } from '../authorizations/authorizations.module';
import { CardsModule } from '../cards/cards.module';
import { RepaymentsModule } from '../repayments/repayments.module';
import { CollateralModule } from '../collateral/collateral.module';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SandboxController } from './sandbox.controller';

@Module({
  imports: [
    CollateralModule,
    CreditAccountsModule,
    WebhooksModule,
    CardsModule,
    AuthorizationsModule,
    RepaymentsModule,
  ],
  controllers: [SandboxController],
})
export class SandboxModule {}
