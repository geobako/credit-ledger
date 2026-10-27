import { randomBytes, randomInt } from 'node:crypto';

const CARD_VALIDITY_YEARS = 4;

/**
 * Issues a virtual card. A real issuer processor would mint the PAN and hand back a token;
 * we keep only what we'd be allowed to keep outside PCI scope: last four digits + token.
 */
export function issueVirtualCard(now = new Date()) {
  return {
    last4: randomInt(0, 10_000).toString().padStart(4, '0'),
    networkToken: `tok_${randomBytes(16).toString('hex')}`,
    expiryMonth: now.getUTCMonth() + 1,
    expiryYear: now.getUTCFullYear() + CARD_VALIDITY_YEARS,
  };
}
