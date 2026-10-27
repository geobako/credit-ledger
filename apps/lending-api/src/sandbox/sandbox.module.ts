import { Module } from '@nestjs/common';
import { CollateralModule } from '../collateral/collateral.module';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SandboxController } from './sandbox.controller';

@Module({
  imports: [CollateralModule, CreditAccountsModule, WebhooksModule],
  controllers: [SandboxController],
})
export class SandboxModule {}
