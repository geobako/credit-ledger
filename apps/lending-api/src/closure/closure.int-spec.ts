import { randomUUID } from 'node:crypto';
import { createTestApp, TestApp } from '../test/app';
import { flows } from '../test/flows';

describe('account closure (HTTP + Postgres)', () => {
  let t: TestApp;
  let f: ReturnType<typeof flows>;

  beforeAll(async () => {
    t = await createTestApp();
    f = flows(t);
  });
  afterAll(() => t.close());

  it('returns all collateral when closed in good standing', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '12000');
    await f.repay(a, '12000');

    const res = await f.close(a).expect(200);
    expect(res.body).toMatchObject({
      reason: 'CUSTOMER_REQUEST',
      debtAtClosure: { amount: '0' },
      collateralApplied: { amount: '0' },
      writtenOff: { amount: '0' },
      payout: { amount: '50000' },
    });
    expect(await f.account(a)).toMatchObject({
      status: 'CLOSED',
      collateral: { amount: '0' },
      creditLimit: { amount: '0' },
      card: { status: 'CLOSED' },
    });
    await f.expectBooksConsistent(a);
  });

  it('applies collateral to an unpaid balance and returns the rest', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '18000');
    const res = await f.close(a).expect(200);
    expect(res.body).toMatchObject({
      debtAtClosure: { amount: '18000' },
      collateralApplied: { amount: '18000' },
      writtenOff: { amount: '0' },
      payout: { amount: '32000' },
    });
    expect(await f.account(a)).toMatchObject({
      outstandingBalance: { amount: '0' },
      collateral: { amount: '0' },
    });
    await f.expectBooksConsistent(a);
  });

  it('uses an overpayment before collateral and returns both remainders', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '4000');
    const first = await f.startRepayment(a, '4000');
    const second = await f.startRepayment(a, '4000');
    await f.settle(first, '4000');
    await f.settle(second, '4000'); // 4000 refund due
    await f.spend(a, '1000'); // new debt, covered by the refund

    const res = await f.close(a).expect(200);
    expect(res.body).toMatchObject({
      refundApplied: { amount: '1000' },
      collateralApplied: { amount: '0' },
      payout: { amount: '53000' },
    });
    await f.expectBooksConsistent(a);
  });

  it('refuses to close while authorizations are pending', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '2000', false);
    expect((await f.close(a).expect(409)).body).toMatchObject({
      code: 'ACCOUNT_HAS_OPEN_AUTHORIZATIONS',
    });
  });

  it('is final: purchases are declined and late payments are rejected for refund', async () => {
    const a = await t.activeAccount('50000');
    const lateDeposit = await t.http
      .post(`/v1/credit-accounts/${a.accountId}/collateral-deposits`)
      .set(f.auth(a.token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '10000' })
      .expect(201);
    await f.close(a).expect(200);

    expect((await f.spend(a, '100', false)).approved).toBe(false);
    const reference = (lateDeposit.body as { paymentInstructions: { reference: string } })
      .paymentInstructions.reference;
    expect((await f.settle(reference, '10000')).body).toMatchObject({
      outcome: 'REJECTED_ACCOUNT_CLOSED',
    });
    expect((await f.account(a)).collateral.amount).toBe('0');
    await f.expectBooksConsistent(a);
  });

  it('is idempotent and lets the customer open a new account afterwards', async () => {
    const a = await t.activeAccount('50000');
    const key = randomUUID();
    const send = () =>
      t.http
        .post(`/v1/credit-accounts/${a.accountId}/closure`)
        .set(f.auth(a.token))
        .set('Idempotency-Key', key)
        .send({});
    const first = await send().expect(200);
    const second = await send().expect(200);
    expect(second.body).toEqual(first.body);
    await f.close(a).expect(200); // a new key on a closed account: same settlement, no double payout

    await t.http
      .post('/v1/credit-accounts')
      .set(f.auth(a.token))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
  });

  it('settles a concurrent double-close exactly once', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '5000');
    const results = await Promise.all(Array.from({ length: 5 }, () => f.close(a)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    await f.expectBooksConsistent(a);
  });

  it('reserves charge-off for operations, and lets them close any account', async () => {
    const a = await t.activeAccount('50000');
    await f.spend(a, '9000');
    expect((await f.close(a, a.token, { reason: 'CHARGE_OFF' }).expect(403)).body).toMatchObject({
      code: 'FORBIDDEN',
    });

    const ops = await t.login('ops@acme.test');
    const res = await f.close(a, ops, { reason: 'CHARGE_OFF' }).expect(200);
    expect(res.body).toMatchObject({
      reason: 'CHARGE_OFF',
      collateralApplied: { amount: '9000' },
      payout: { amount: '41000' },
    });

    const stranger = await t.newCustomer();
    const b = await t.activeAccount('10000');
    await f.close(b, stranger).expect(404);
  });
});
