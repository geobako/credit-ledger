import { randomUUID } from 'node:crypto';
import { transfer } from '../ledger/journal-entry';
import { LedgerService } from '../ledger/ledger.service';
import { connectTestDatabase, TestDatabase } from '../test/database';
import { createCustomerAccounts, usd } from '../test/ledger-fixtures';
import { IdempotencyKeyReusedError } from './idempotency.errors';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService (Postgres)', () => {
  let t: TestDatabase;
  const ledger = new LedgerService();
  const idempotency = new IdempotencyService();

  beforeAll(() => {
    t = connectTestDatabase();
  });
  afterAll(() => t.close());

  const request = (key = randomUUID(), requestHash = 'a'.repeat(64)) => ({
    scope: 'test:deposits.create',
    key,
    requestHash,
  });

  it('runs the work once and replays the stored response afterwards', async () => {
    const req = request();
    let runs = 0;
    const work = () => {
      runs++;
      return Promise.resolve({ status: 201, body: { id: 'dep_1', amount: usd(500) } });
    };

    const first = await t.tx.run((tx) => idempotency.execute(tx, req, work));
    const second = await t.tx.run((tx) => idempotency.execute(tx, req, work));

    expect(runs).toBe(1);
    expect(first).toEqual({
      status: 201,
      body: { id: 'dep_1', amount: { amount: '500', currency: 'USD' } },
      replayed: false,
    });
    expect(second).toEqual({ ...first, replayed: true });
  });

  it('rejects the same key with a different request', async () => {
    const key = randomUUID();
    await t.tx.run((tx) =>
      idempotency.execute(tx, request(key), () => Promise.resolve({ status: 201, body: {} })),
    );

    await expect(
      t.tx.run((tx) =>
        idempotency.execute(tx, request(key, 'b'.repeat(64)), () =>
          Promise.resolve({ status: 201, body: {} }),
        ),
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('releases the key when the work fails, so a retry really runs', async () => {
    const req = request();
    await expect(
      t.tx.run((tx) => idempotency.execute(tx, req, () => Promise.reject(new Error('boom')))),
    ).rejects.toThrow('boom');

    const retry = await t.tx.run((tx) =>
      idempotency.execute(tx, req, () => Promise.resolve({ status: 201, body: { ok: true } })),
    );
    expect(retry).toEqual({ status: 201, body: { ok: true }, replayed: false });
  });

  it('scopes keys: the same key in another scope is independent', async () => {
    const key = randomUUID();
    const a = await t.tx.run((tx) =>
      idempotency.execute(tx, { ...request(key), scope: 'customer:1:x' }, () =>
        Promise.resolve({ status: 201, body: 1 }),
      ),
    );
    const b = await t.tx.run((tx) =>
      idempotency.execute(tx, { ...request(key), scope: 'customer:2:x' }, () =>
        Promise.resolve({ status: 201, body: 2 }),
      ),
    );
    expect([a.replayed, b.replayed, a.body, b.body]).toEqual([false, false, 1, 2]);
  });

  it('applies a money movement exactly once under 20 concurrent duplicate requests', async () => {
    const accounts = await createCustomerAccounts(t, ledger);
    const req = request();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        t.tx.run((tx) =>
          idempotency.execute(tx, req, async () => {
            const entry = await ledger.post(tx, {
              type: 'COLLATERAL_CONFIRMED',
              description: 'deposit',
              postings: transfer(
                accounts.collateralCash.id,
                accounts.collateralHeld.id,
                usd(2_500),
              ),
            });
            return { status: 201, body: { entryId: entry.id } };
          }),
        ),
      ),
    );

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await ledger.balanceOf(t.db, accounts.collateralHeld.id)).minor).toBe(2_500n);
  });
});
