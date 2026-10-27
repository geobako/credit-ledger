import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { AuthorizationsService } from './authorizations.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('credit-accounts/:accountId/authorizations')
export class AuthorizationsController {
  constructor(private readonly authorizations: AuthorizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Card transactions: holds, captured purchases, reversals and declines' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.authorizations.listForAccount(principal, accountId);
  }
}
