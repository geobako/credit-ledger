import { Module } from '@nestjs/common';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { ClosureController } from './closure.controller';
import { ClosureService } from './closure.service';

@Module({
  imports: [CreditAccountsModule],
  controllers: [ClosureController],
  providers: [ClosureService],
})
export class ClosureModule {}
