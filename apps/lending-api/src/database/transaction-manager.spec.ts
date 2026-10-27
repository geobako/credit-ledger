import type { Database } from './database';
import { TransactionManager } from './transaction-manager';

const pgError = (code: string) => Object.assign(new Error(code), { code });

function fakeDb(failures: Error[]) {
  const calls: unknown[] = [];
  const db = {
    transaction: (work: (tx: unknown) => Promise<unknown>, config: unknown) => {
      calls.push(config);
      const failure = failures.shift();
      return failure ? Promise.reject(failure) : work('tx');
    },
  };
  return { db: db as unknown as Database, calls };
}

describe('TransactionManager', () => {
  it('defaults to READ COMMITTED', async () => {
    const { db, calls } = fakeDb([]);
    await expect(new TransactionManager(db).run(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(calls).toEqual([{ isolationLevel: 'read committed' }]);
  });

  it.each(['40001', '40P01'])('retries transient failure %s', async (code) => {
    const { db, calls } = fakeDb([pgError(code)]);
    await expect(new TransactionManager(db).run(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('finds the Postgres error inside a wrapping error', async () => {
    const wrapped = new Error('query failed', { cause: pgError('40001') });
    const { db, calls } = fakeDb([wrapped]);
    await new TransactionManager(db).run(() => Promise.resolve('ok'));
    expect(calls).toHaveLength(2);
  });

  it('gives up after maxAttempts', async () => {
    const { db, calls } = fakeDb([pgError('40001'), pgError('40001'), pgError('40001')]);
    await expect(
      new TransactionManager(db).run(() => Promise.resolve('ok'), { maxAttempts: 3 }),
    ).rejects.toThrow('40001');
    expect(calls).toHaveLength(3);
  });

  it('does not retry business errors', async () => {
    const { db, calls } = fakeDb([pgError('23514')]);
    await expect(new TransactionManager(db).run(() => Promise.resolve('ok'))).rejects.toThrow(
      '23514',
    );
    expect(calls).toHaveLength(1);
  });
});
