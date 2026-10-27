import { Module } from '@nestjs/common';
import { CreditAccountsController } from './credit-accounts.controller';
import { CreditAccountsService } from './credit-accounts.service';

@Module({
  controllers: [CreditAccountsController],
  providers: [CreditAccountsService],
  exports: [CreditAccountsService],
})
export class CreditAccountsModule {}
