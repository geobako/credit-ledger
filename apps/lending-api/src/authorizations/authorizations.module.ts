import { Module } from '@nestjs/common';
import { CreditAccountsModule } from '../credit-accounts/credit-accounts.module';
import { AuthorizationExpiryJob } from './authorization-expiry.job';
import { AuthorizationsController } from './authorizations.controller';
import { AuthorizationsService } from './authorizations.service';
import { NetworkController } from './network.controller';

@Module({
  imports: [CreditAccountsModule],
  controllers: [NetworkController, AuthorizationsController],
  providers: [AuthorizationsService, AuthorizationExpiryJob],
  exports: [AuthorizationsService],
})
export class AuthorizationsModule {}
