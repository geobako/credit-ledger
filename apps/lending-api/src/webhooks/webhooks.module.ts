import { Module } from '@nestjs/common';
import { CollateralModule } from '../collateral/collateral.module';
import { RepaymentsModule } from '../repayments/repayments.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [CollateralModule, RepaymentsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
