import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';
import { UnauthenticatedError } from './auth.errors';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const env = loadEnv({
    DATABASE_URL: 'postgres://u:p@h/db',
    WEBHOOK_SECRET: 'x'.repeat(32),
    GATEWAY_SHARED_SECRET: 'g'.repeat(32),
  });
  const tokens = new TokenService(env);
  const principal = {
    userId: 'u1',
    email: 'a@acme.test',
    role: 'customer' as const,
    sessionId: 's1',
  };

  it('round-trips a principal', () => {
    expect(tokens.verify(tokens.issue(principal).accessToken)).toEqual(principal);
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = tokens.issue(principal).accessToken.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'u1', email: 'a@acme.test', role: 'ops' }),
    ).toString('base64url');
    expect(() => tokens.verify(`${header}.${forged}.${signature}`)).toThrow(UnauthenticatedError);
  });

  it('rejects unsigned (alg=none) tokens', () => {
    const unsigned = jwt.sign({ sub: 'u1', email: 'x', role: 'ops' }, '', {
      algorithm: 'none',
      issuer: 'acme-credit-idp',
      audience: 'lending-api',
    });
    expect(() => tokens.verify(unsigned)).toThrow(UnauthenticatedError);
  });

  it('rejects tokens without a session id (issued outside a sign-in)', () => {
    const sessionless = jwt.sign({ sub: 'u1', email: 'x', role: 'customer' }, env.JWT_PRIVATE_KEY, {
      algorithm: 'ES256',
      issuer: 'acme-credit-idp',
      audience: 'lending-api',
    });
    expect(() => tokens.verify(sessionless)).toThrow(UnauthenticatedError);
  });

  it('rejects tokens from another issuer key', () => {
    const other = new TokenService(
      loadEnv({
        DATABASE_URL: 'postgres://u:p@h/db',
        WEBHOOK_SECRET: 'x'.repeat(32),
        GATEWAY_SHARED_SECRET: 'g'.repeat(32),
      }),
    );
    expect(() => tokens.verify(other.issue(principal).accessToken)).toThrow(UnauthenticatedError);
  });

  it('rejects expired tokens', () => {
    const expired = jwt.sign({ sub: 'u1', email: 'x', role: 'customer' }, env.JWT_PRIVATE_KEY, {
      algorithm: 'ES256',
      issuer: 'acme-credit-idp',
      audience: 'lending-api',
      expiresIn: -10,
    });
    expect(() => tokens.verify(expired)).toThrow(UnauthenticatedError);
  });

  it('rejects tokens minted for another audience', () => {
    const wrongAudience = jwt.sign(
      { sub: 'u1', email: 'x', role: 'customer' },
      env.JWT_PRIVATE_KEY,
      {
        algorithm: 'ES256',
        issuer: 'acme-credit-idp',
        audience: 'some-other-api',
      },
    );
    expect(() => tokens.verify(wrongAudience)).toThrow(UnauthenticatedError);
  });
});
