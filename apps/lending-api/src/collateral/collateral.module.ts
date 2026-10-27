import { Module } from '@nestjs/common';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { CollateralController } from './collateral.controller';
import { CollateralService } from './collateral.service';

@Module({
  imports: [CreditAccountsModule],
  controllers: [CollateralController],
  providers: [CollateralService],
  exports: [CollateralService],
})
export class CollateralModule {}
