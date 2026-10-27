import {
  InvalidWebhookSignatureError,
  signWebhook,
  verifyWebhookSignature,
} from './webhook-signature';

describe('webhook signatures', () => {
  const secret = 's'.repeat(40);
  const body = Buffer.from('{"id":"evt_1"}');
  const now = 1_800_000_000;

  it('accepts a fresh, correctly signed body', () => {
    expect(() =>
      verifyWebhookSignature(secret, body, signWebhook(secret, body, now), 300, now),
    ).not.toThrow();
  });

  it.each([
    ['missing header', undefined],
    ['malformed header', 'garbage'],
    ['wrong secret', signWebhook('x'.repeat(40), body, now)],
    ['tampered body', signWebhook(secret, Buffer.from('{"id":"evt_2"}'), now)],
    ['stale timestamp (replay)', signWebhook(secret, body, now - 301)],
    ['future timestamp', signWebhook(secret, body, now + 301)],
    ['truncated signature', signWebhook(secret, body, now).slice(0, -2)],
  ])('rejects %s', (_label, header) => {
    expect(() => verifyWebhookSignature(secret, body, header, 300, now)).toThrow(
      InvalidWebhookSignatureError,
    );
  });
});
