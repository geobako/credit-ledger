import { createHmac, timingSafeEqual } from 'node:crypto';

export const SERVICE_SIGNATURE_HEADER = 'x-signature';
export const SERVICE_ID_HEADER = 'x-service-id';

/**
 * Signature for internal service-to-service calls (card gateway → lending API):
 * `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>\n<METHOD>\n<path>\n<raw body>")>`.
 * Method and path are signed with the body, so a captured signature cannot be replayed
 * against another endpoint (e.g. a capture turned into a reversal).
 */
export function signRequest(
  secret: string,
  method: string,
  path: string,
  rawBody: string | Buffer = '',
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${digest(secret, timestamp, method, path, rawBody)}`;
}

export type SignatureCheck = 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch';

export function checkRequestSignature(
  secret: string,
  method: string,
  path: string,
  rawBody: Buffer,
  header: string | undefined,
  toleranceSeconds: number,
  now = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header) return 'missing';
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=', 2) as [string, string]),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature))
    return 'malformed';
  if (Math.abs(now - timestamp) > toleranceSeconds) return 'stale';
  const expected = Buffer.from(digest(secret, timestamp, method, path, rawBody), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? 'ok' : 'mismatch';
}

function digest(
  secret: string,
  timestamp: number,
  method: string,
  path: string,
  rawBody: string | Buffer,
) {
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${method.toUpperCase()}\n${path}\n`)
    .update(rawBody)
    .digest('hex');
}
