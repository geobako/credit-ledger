import { checkRequestSignature, signRequest } from './request-signature';

describe('service request signatures', () => {
  const secret = 'g'.repeat(40);
  const body = Buffer.from('{"amount":"100"}');
  const now = 1_800_000_000;
  const path = '/v1/network/authorizations';
  const check = (header: string | undefined, method = 'POST', p = path, b = body) =>
    checkRequestSignature(secret, method, p, b, header, 300, now);

  it('accepts a valid signature', () => {
    expect(check(signRequest(secret, 'POST', path, body, now))).toBe('ok');
  });

  it('binds the signature to method, path and body', () => {
    const header = signRequest(secret, 'POST', `${path}/a1/capture`, body, now);
    expect(check(header, 'POST', `${path}/a1/reverse`)).toBe('mismatch');
    expect(check(header, 'GET', `${path}/a1/capture`)).toBe('mismatch');
    expect(check(header, 'POST', `${path}/a1/capture`, Buffer.from('{"amount":"999"}'))).toBe(
      'mismatch',
    );
  });

  it('rejects stale, malformed and missing signatures', () => {
    expect(check(signRequest(secret, 'POST', path, body, now - 400))).toBe('stale');
    expect(check('t=abc,v1=zz')).toBe('malformed');
    expect(check(undefined)).toBe('missing');
    expect(check(signRequest('x'.repeat(40), 'POST', path, body, now))).toBe('mismatch');
  });
});
