import { Module } from '@nestjs/common';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';

@Module({
  imports: [CreditAccountsModule],
  controllers: [CardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
