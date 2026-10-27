import { loadEnv } from './env';

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    WEBHOOK_SECRET: 'x'.repeat(32),
    GATEWAY_SHARED_SECRET: 'g'.repeat(32),
  };

  it('applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_POOL_MAX: 20,
      ADVANCE_RATE_BPS: 10_000,
      MIN_DEPOSIT_MINOR: 5_000n,
      SANDBOX_ENABLED: false,
      WEB_ORIGINS: ['http://localhost:5173'],
    });
  });

  it('coerces numeric values', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('generates an ephemeral signing key pair outside production', () => {
    const env = loadEnv(valid);
    expect(env.JWT_PRIVATE_KEY).toContain('BEGIN PRIVATE KEY');
    expect(env.JWT_PUBLIC_KEY).toContain('BEGIN PUBLIC KEY');
  });

  it('requires explicit keys and forbids the sandbox in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', SANDBOX_ENABLED: 'true' })).toThrow(
      /JWT_PRIVATE_KEY[\s\S]*SANDBOX_ENABLED/,
    );
  });

  it('rejects a short webhook secret', () => {
    expect(() => loadEnv({ ...valid, WEBHOOK_SECRET: 'short' })).toThrow(/WEBHOOK_SECRET/);
  });

  it('rejects a missing or non-postgres database url', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
