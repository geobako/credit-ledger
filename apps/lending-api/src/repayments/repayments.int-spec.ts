import { randomUUID } from 'node:crypto';
import { createTestApp, TestApp } from '../test/app';
import { flows } from '../test/flows';

describe('repayments (HTTP + Postgres)', () => {
  let t: TestApp;
  let f: ReturnType<typeof flows>;

  beforeAll(async () => {
    t = await createTestApp();
    f = flows(t);
  });
  afterAll(() => t.close());

  it('restores available credit once the repayment settles', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '20000');
    expect(await f.account(a)).toMatchObject({
      outstandingBalance: { amount: '20000' },
      availableCredit: { amount: '30000' },
    });

    const reference = await f.startRepayment(a, '15000');
    // Initiating a repayment changes nothing: only settled money counts.
    expect((await f.account(a)).availableCredit.amount).toBe('30000');

    const ack = await f.settle(reference, '15000');
    expect(ack.body).toMatchObject({ outcome: 'SETTLED' });
    expect(await f.account(a)).toMatchObject({
      outstandingBalance: { amount: '5000' },
      availableCredit: { amount: '45000' },
    });
    await f.expectBooksConsistent(a);
  });

  it('lets the customer spend again after repaying a maxed-out card', async () => {
    const a = await t.activeAccount('10000');
    await f.spend(a, '10000');
    expect((await f.spend(a, '1', false)).approved).toBe(false);
    await f.repay(a, '10000');
    expect((await f.spend(a, '10000', false)).approved).toBe(true);
  });

  it('refuses repayments with nothing owed or above the balance', async () => {
    const a = await t.activeAccount('50000');
    const attempt = (amount: string) =>
      t.http
        .post(`/v1/credit-accounts/${a.accountId}/repayments`)
        .set(f.auth(a.token))
        .set('Idempotency-Key', randomUUID())
        .send({ amount });
    expect((await attempt('100').expect(422)).body).toMatchObject({ code: 'NOTHING_TO_REPAY' });
    await f.spend(a, '3000');
    expect((await attempt('3001').expect(422)).body).toMatchObject({
      code: 'REPAYMENT_EXCEEDS_BALANCE',
    });
  });

  it('books an overpayment as a refund instead of losing it', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '8000');
    // Two repayments for the full balance are started before either settles.
    const first = await f.startRepayment(a, '8000');
    const second = await f.startRepayment(a, '8000');
    await f.settle(first, '8000');
    await f.settle(second, '8000');

    expect(await f.account(a)).toMatchObject({
      outstandingBalance: { amount: '0' },
      refundDue: { amount: '8000' },
      availableCredit: { amount: '50000' },
    });
    const list = await t.http
      .get(`/v1/credit-accounts/${a.accountId}/repayments`)
      .set(f.auth(a.token))
      .expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appliedAmount: { amount: '0', currency: 'USD' },
          excessAmount: { amount: '8000', currency: 'USD' },
        }),
        expect.objectContaining({
          appliedAmount: { amount: '8000', currency: 'USD' },
          excessAmount: { amount: '0', currency: 'USD' },
        }),
      ]),
    );
    await f.expectBooksConsistent(a);
  });

  it('applies a repayment exactly once when the provider delivers it concurrently', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '6000');
    const reference = await f.startRepayment(a, '6000');
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      data: { reference, amount: '6000', currency: 'USD' },
    };
    await Promise.all(Array.from({ length: 8 }, () => t.deliverWebhook(event).expect(200)));
    expect(await f.account(a)).toMatchObject({
      outstandingBalance: { amount: '0' },
      refundDue: { amount: '0' },
    });
  });

  it('keeps the books consistent while purchases and repayments race', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '30000');
    const references = await Promise.all(
      Array.from({ length: 5 }, () => f.startRepayment(a, '5000')),
    );
    await Promise.all([
      ...references.map((r) => f.settle(r, '5000')),
      ...Array.from({ length: 10 }, () => f.spend(a, '2500')),
    ]);
    const view = await f.account(a);
    expect(
      BigInt(view.outstandingBalance.amount) + BigInt(view.heldAmount.amount),
    ).toBeLessThanOrEqual(50_000n);
    await f.expectBooksConsistent(a);
  });
});
