/** Closing with unpaid debt, overpayments, and the guards around closure. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activeCustomer,
  authorize,
  capture,
  deliverPaymentEvent,
  expect,
  getAccount,
  minor,
  repayAndConfirm,
} from './lib/stack.ts';

describe('closure with debt', () => {
  test('collateral is applied to unpaid debt and only the remainder is returned', async () => {
    const { customer, account, token } = await activeCustomer(30_000, 'debt');
    const auth = await authorize(token, 25_000);
    assert.equal(auth.body.response_code, '00');
    expect(await capture(auth.body.authorization_id!), 200);
    await repayAndConfirm(customer, account.id, 5_000);

    const res = await customer.post(`/v1/credit-accounts/${account.id}/closure`, {});
    expect(res, 200);
    assert.equal(res.body.debtAtClosure.amount, '20000');
    assert.equal(res.body.collateralApplied.amount, '20000');
    assert.equal(res.body.writtenOff.amount, '0');
    assert.equal(res.body.payout.amount, '10000');

    const closed = await getAccount(customer, account.id);
    assert.equal(minor(closed.outstandingBalance), 0n);
    assert.equal(minor(closed.collateral), 0n);
  });

  test('closing is refused while a purchase is still on hold', async () => {
    const { customer, account, token } = await activeCustomer(10_000, 'holds');
    assert.equal((await authorize(token, 1_000)).body.response_code, '00');
    const res = await customer.post(`/v1/credit-accounts/${account.id}/closure`, {});
    expect(res, 409);
    assert.equal(res.body.code, 'ACCOUNT_HAS_OPEN_AUTHORIZATIONS');
  });

  test('an overpayment is never lost: it is owed back and paid out at closure', async () => {
    const { customer, account, token } = await activeCustomer(20_000, 'overpay');
    const auth = await authorize(token, 4_000);
    expect(await capture(auth.body.authorization_id!), 200);

    // Two payments for the full balance, both valid when created, both settle.
    const first = await customer.post(`/v1/credit-accounts/${account.id}/repayments`, {
      amount: '4000',
    });
    const second = await customer.post(`/v1/credit-accounts/${account.id}/repayments`, {
      amount: '4000',
    });
    for (const r of [first, second]) {
      expect(r, 201);
      expect(
        await deliverPaymentEvent({
          type: 'payment.succeeded',
          reference: r.body.paymentInstructions.reference,
          amount: '4000',
        }),
        200,
      );
    }
    const a = await getAccount(customer, account.id);
    assert.equal(minor(a.outstandingBalance), 0n);
    assert.equal(minor(a.refundDue), 4_000n);
    assert.equal(minor(a.availableCredit), 20_000n, 'overpaying never raises the limit');

    const closure = await customer.post(`/v1/credit-accounts/${account.id}/closure`, {});
    expect(closure, 200);
    assert.equal(closure.body.payout.amount, '24000', 'collateral + overpayment');
  });

  test('a failed repayment changes nothing', async () => {
    const { customer, account, token } = await activeCustomer(10_000, 'failed-pay');
    expect(await capture((await authorize(token, 3_000)).body.authorization_id!), 200);
    const r = await customer.post(`/v1/credit-accounts/${account.id}/repayments`, {
      amount: '3000',
    });
    const ack = await deliverPaymentEvent({
      type: 'payment.failed',
      reference: r.body.paymentInstructions.reference,
      amount: '3000',
      failureReason: 'INSUFFICIENT_FUNDS_AT_SOURCE',
    });
    assert.equal(ack.body.outcome, 'FAILED');
    assert.equal(minor((await getAccount(customer, account.id)).outstandingBalance), 3_000n);
  });
});
