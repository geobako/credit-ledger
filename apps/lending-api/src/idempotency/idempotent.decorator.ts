import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/decorators';
import { parseIdempotencyKey, IDEMPOTENCY_KEY_HEADER } from './idempotency-key.decorator';
import { IdempotentRequest, IdempotentResult } from './idempotency.service';
import { hashRequest } from './request-hash';

/**
 * Builds the idempotency context of a mutating request: the client's key, a fingerprint of
 * the request, and a scope of caller + operation so keys can never collide across users.
 */
export const Idempotent = createParamDecorator(
  (operation: string, ctx: ExecutionContext): IdempotentRequest => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = parseIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const caller = req.principal?.userId ?? 'anonymous';
    return {
      scope: `${caller}:${operation}`,
      key,
      requestHash: hashRequest({ method: req.method, path: req.originalUrl, body: req.body }),
    };
  },
);

/** Writes an idempotent result: its stored status, plus a header telling clients it was a replay. */
export function respond<T>(res: Response, result: IdempotentResult<T>): T {
  res.status(result.status);
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return result.body;
}
