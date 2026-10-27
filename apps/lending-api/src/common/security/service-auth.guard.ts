import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  RawBodyRequest,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/decorators';
import { ENV, Env } from '../../config/env';
import { DomainError } from '../errors/domain-error';
import {
  checkRequestSignature,
  SERVICE_ID_HEADER,
  SERVICE_SIGNATURE_HEADER,
} from './request-signature';

export class InvalidServiceSignatureError extends DomainError {
  readonly code = 'INVALID_SERVICE_SIGNATURE';
  readonly kind = 'unauthenticated';
}

const KNOWN_SERVICES = new Set(['card-gateway']);
const TOLERANCE_SECONDS = 300;

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const service = req.headers[SERVICE_ID_HEADER];
    if (typeof service !== 'string' || !KNOWN_SERVICES.has(service)) {
      throw new InvalidServiceSignatureError('unknown calling service');
    }
    const result = checkRequestSignature(
      this.env.GATEWAY_SHARED_SECRET,
      req.method,
      req.originalUrl,
      req.rawBody ?? Buffer.alloc(0),
      req.headers[SERVICE_SIGNATURE_HEADER] as string | undefined,
      TOLERANCE_SECONDS,
    );
    if (result !== 'ok') {
      throw new InvalidServiceSignatureError(`service signature check failed: ${result}`);
    }
    return true;
  }
}

/**
 * Marks a controller as internal: no user token, but every request must be HMAC-signed by a
 * known service. Rate limiting is the gateway's job (it sits in front), so it is skipped here.
 */
export const ServiceAuth = () =>
  applyDecorators(Public(), SkipThrottle(), UseGuards(ServiceAuthGuard));
