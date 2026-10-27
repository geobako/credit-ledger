import { Module } from '@nestjs/common';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { RepaymentsController } from './repayments.controller';
import { RepaymentsService } from './repayments.service';

@Module({
  imports: [CreditAccountsModule],
  controllers: [RepaymentsController],
  providers: [RepaymentsService],
  exports: [RepaymentsService],
})
export class RepaymentsModule {}
