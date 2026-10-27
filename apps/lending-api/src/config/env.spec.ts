import { loadEnv } from './env';

describe('loadEnv', () => {
  const valid = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

  it('applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_POOL_MAX: 20,
    });
  });

  it('coerces numeric values', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing database url', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres database url', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });
});
