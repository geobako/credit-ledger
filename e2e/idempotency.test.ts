/** Retries, redeliveries and retransmissions must never move money twice. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  activeCustomer,
  authorize,
  capture,
  deliverPaymentEvent,
  expect,
  getAccount,
  minor,
  newCustomer,
  openAccount,
} from './lib/stack.ts';

describe('idempotency', () => {
  test('a retried request with the same Idempotency-Key replays the first result', async () => {
    const customer = await newCustomer('idem');
    const account = await openAccount(customer);
    const key = randomUUID();
    const path = `/v1/credit-accounts/${account.id}/collateral-deposits`;

    const first = await customer.post(path, { amount: '10000' }, key);
    const retry = await customer.post(path, { amount: '10000' }, key);
    expect(first, 201);
    expect(retry, 201);
    assert.equal(retry.body.deposit.id, first.body.deposit.id);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');

    const deposits = await customer.get(path);
    assert.equal(deposits.body.length, 1);
  });

  test('reusing a key for a different request is rejected', async () => {
    const customer = await newCustomer('idem-reuse');
    const account = await openAccount(customer);
    const key = randomUUID();
    const path = `/v1/credit-accounts/${account.id}/collateral-deposits`;
    expect(await customer.post(path, { amount: '10000' }, key), 201);
    const reused = await customer.post(path, { amount: '99999' }, key);
    expect(reused, 422);
    assert.equal(reused.body.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  test('money-moving requests without a key are refused', async () => {
    const customer = await newCustomer('idem-missing');
    const res = await customer.request('/v1/credit-accounts', { method: 'POST', body: {} });
    expect(res, 400);
  });

  test('a redelivered webhook is acknowledged but applied once', async () => {
    const customer = await newCustomer('redeliver');
    const account = await openAccount(customer);
    const dep = await customer.post(`/v1/credit-accounts/${account.id}/collateral-deposits`, {
      amount: '15000',
    });
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'payment.succeeded' as const,
      reference: dep.body.paymentInstructions.reference,
      amount: '15000',
    };

    const first = await deliverPaymentEvent(event);
    const again = await deliverPaymentEvent(event);
    assert.equal(first.body.duplicate, false);
    assert.equal(again.body.duplicate, true);

    // Same payment reported under a new event id: recognised as already settled.
    const reissued = await deliverPaymentEvent({ ...event, id: `evt_${randomUUID()}` });
    assert.equal(reissued.body.outcome, 'ALREADY_SETTLED');

    assert.equal(minor((await getAccount(customer, account.id)).collateral), 15_000n);
  });

  test('a payment for the wrong amount is rejected, not partially credited', async () => {
    const customer = await newCustomer('mismatch');
    const account = await openAccount(customer);
    const dep = await customer.post(`/v1/credit-accounts/${account.id}/collateral-deposits`, {
      amount: '15000',
    });
    const ack = await deliverPaymentEvent({
      type: 'payment.succeeded',
      reference: dep.body.paymentInstructions.reference,
      amount: '1500',
    });
    assert.equal(ack.body.outcome, 'REJECTED_AMOUNT_MISMATCH');
    const a = await getAccount(customer, account.id);
    assert.equal(a.status, 'PENDING_COLLATERAL');
    assert.equal(minor(a.collateral), 0n);
  });

  test('a network retransmission returns the original decision and holds once', async () => {
    const { customer, account, token } = await activeCustomer(10_000, 'retransmit');
    const txId = `e2e_${randomUUID()}`;
    const first = await authorize(token, 2_500, { txId });
    const again = await authorize(token, 2_500, { txId });
    assert.equal(first.body.response_code, '00');
    assert.equal(again.body.response_code, '00');
    assert.equal(again.body.authorization_id, first.body.authorization_id);
    assert.equal(minor((await getAccount(customer, account.id)).heldAmount), 2_500n);
  });

  test('a transaction id reused for a different purchase is flagged as duplicate', async () => {
    const { token } = await activeCustomer(10_000, 'dup-tx');
    const txId = `e2e_${randomUUID()}`;
    assert.equal((await authorize(token, 1_000, { txId })).body.response_code, '00');
    const res = await authorize(token, 9_000, { txId });
    assert.equal(res.body.approved, false);
    assert.equal(res.body.response_code, '94');
  });

  test('a repeated capture is a no-op', async () => {
    const { customer, account, token } = await activeCustomer(10_000, 'recapture');
    const id = (await authorize(token, 4_000)).body.authorization_id!;
    expect(await capture(id), 200);
    expect(await capture(id), 200);
    assert.equal(minor((await getAccount(customer, account.id)).outstandingBalance), 4_000n);
  });
});
