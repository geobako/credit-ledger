import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../common/errors/domain-error';

export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

export class InvalidWebhookSignatureError extends DomainError {
  readonly code = 'INVALID_WEBHOOK_SIGNATURE';
  readonly kind = 'unauthenticated';
}

/**
 * Stripe-style signature: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Signing the timestamp with the body lets us reject replays of old, validly signed events.
 */
export function signWebhook(
  secret: string,
  rawBody: string | Buffer,
  timestamp = nowSeconds(),
): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, rawBody)}`;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
  toleranceSeconds: number,
  now = nowSeconds(),
): void {
  if (!header) throw new InvalidWebhookSignatureError('missing webhook signature');
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.trim().split('=', 2) as [string, string]),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new InvalidWebhookSignatureError('malformed webhook signature');
  }
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new InvalidWebhookSignatureError('webhook timestamp outside the tolerance window');
  }
  const expected = Buffer.from(hmac(secret, timestamp, rawBody), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    throw new InvalidWebhookSignatureError('webhook signature does not match');
  }
}

function hmac(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
