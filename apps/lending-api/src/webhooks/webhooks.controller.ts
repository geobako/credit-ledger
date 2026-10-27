import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { RequestContext } from '../common/context/request-context';
import { WEBHOOK_SIGNATURE_HEADER } from './webhook-signature';
import { WebhooksService } from './webhooks.service';

/** Authenticated by HMAC signature instead of a bearer token. */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('payments')
  @HttpCode(200)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(WEBHOOK_SIGNATURE_HEADER) signature: string | undefined,
  ) {
    RequestContext.setActor({ type: 'provider', id: 'sandbox-pay' });
    return this.webhooks.handlePaymentEvent(req.rawBody, signature);
  }
}
