import { BadRequestException } from '@nestjs/common';
import { parseIdempotencyKey } from './idempotency-key.decorator';
import { canonicalJson, hashRequest } from './request-hash';

describe('request hashing', () => {
  it('ignores object key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(
      '{"a":{"c":[{"x":2,"y":1}],"d":2},"b":1}',
    );
    expect(hashRequest({ method: 'post', path: '/x', body: { a: 1, b: 2 } })).toBe(
      hashRequest({ method: 'POST', path: '/x', body: { b: 2, a: 1 } }),
    );
  });

  it('distinguishes different bodies, paths and array order', () => {
    const base = { method: 'POST', path: '/x', body: { amount: '100' } };
    const h = hashRequest(base);
    expect(hashRequest({ ...base, body: { amount: '101' } })).not.toBe(h);
    expect(hashRequest({ ...base, path: '/y' })).not.toBe(h);
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe('parseIdempotencyKey', () => {
  it('accepts UUIDs and network transaction ids', () => {
    expect(parseIdempotencyKey('3f1c2b9e-7d7a-4c1e-9a55-0b8f0f5d2c11')).toBeDefined();
    expect(parseIdempotencyKey('visa:txn:000123456')).toBe('visa:txn:000123456');
  });

  it.each([undefined, 'short', 'has space in it', ['a', 'b'], 'x'.repeat(256)])(
    'rejects %p',
    (value) => {
      expect(() => parseIdempotencyKey(value as string)).toThrow(BadRequestException);
    },
  );
});
