import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency, Money } from '../common/money/money';
import { ServiceAuth } from '../common/security/service-auth.guard';
import { AuthorizeDto, CaptureDto } from './authorizations.dto';
import { AuthorizationsService } from './authorizations.service';

/** Internal API for the card gateway. Requests are HMAC-signed by the gateway, not by users. */
@ApiTags('network (internal)')
@ServiceAuth()
@Controller('network/authorizations')
export class NetworkController {
  constructor(private readonly authorizations: AuthorizationsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Authorize a purchase (approve with a hold, or decline)' })
  async authorize(@Body() dto: AuthorizeDto) {
    const decision = await this.authorizations.authorize({
      networkTransactionId: dto.networkTransactionId,
      cardToken: dto.cardToken,
      amount: Money.of(dto.amount, dto.currency),
      merchantName: dto.merchantName,
      merchantCategoryCode: dto.merchantCategoryCode,
    });
    // A retried authorization gets the original decision; the gateway does not need to know.
    return {
      networkTransactionId: decision.networkTransactionId,
      authorizationId: decision.authorizationId,
      approved: decision.approved,
      status: decision.status,
      declineReason: decision.declineReason,
      amount: decision.amount,
    };
  }

  @Post(':id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Capture (settle) an authorization' })
  async capture(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CaptureDto) {
    const auth = await this.authorizations.get(id);
    return this.authorizations.capture(
      id,
      dto.amount ? Money.of(dto.amount, auth.currency as Currency) : undefined,
    );
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reverse an authorization, releasing its hold' })
  reverse(@Param('id', ParseUUIDPipe) id: string) {
    return this.authorizations.reverse(id);
  }
}
