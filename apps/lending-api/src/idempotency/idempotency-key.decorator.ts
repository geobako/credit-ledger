import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const VALID_KEY = /^[A-Za-z0-9_.:-]{8,255}$/;

/** Extracts and validates the required `Idempotency-Key` header of a mutating request. */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const value = ctx.switchToHttp().getRequest<Request>().headers[IDEMPOTENCY_KEY_HEADER];
  return parseIdempotencyKey(value);
});

export function parseIdempotencyKey(value: string | string[] | undefined): string {
  if (value === undefined) {
    throw new BadRequestException('Idempotency-Key header is required for this operation');
  }
  if (typeof value !== 'string' || !VALID_KEY.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8-255 characters of [A-Za-z0-9_.:-] (a UUID is recommended)',
    );
  }
  return value;
}
