/**
 * Real parallelism against the API (no browser connection cap). The card gateway rate-limits
 * per card, so the burst goes to the lending API's internal endpoint, signed as the gateway.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  activeCustomer,
  capture,
  deliverPaymentEvent,
  expect,
  getAccount,
  minor,
  newCustomer,
  openAccount,
  reverse,
  signedNetworkAuthorize,
} from './lib/stack.ts';

describe('concurrency', () => {
  test('100 simultaneous purchases never exceed the limit', async () => {
    const { customer, account, token } = await activeCustomer(50_000, 'burst');
    const results = await Promise.all(
      Array.from({ length: 100 }, () => signedNetworkAuthorize(token, 700)),
    );
    for (const r of results) expect(r, 200);
    const approved = results.filter((r) => r.body.approved).length;
    const declined = results.filter((r) => r.body.declineReason === 'INSUFFICIENT_CREDIT').length;

    assert.equal(approved, 71, '⌊$500 ÷ $7⌋ = 71, exactly');
    assert.equal(declined, 29);
    const a = await getAccount(customer, account.id);
    assert.equal(minor(a.heldAmount), 71n * 700n);
    assert.equal(minor(a.availableCredit), 50_000n - 71n * 700n);
  });

  test('concurrent requests with one Idempotency-Key create one deposit', async () => {
    const customer = await newCustomer('idem-race');
    const account = await openAccount(customer);
    const key = randomUUID();
    const path = `/v1/credit-accounts/${account.id}/collateral-deposits`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => customer.post(path, { amount: '10000' }, key)),
    );
    const ids = new Set(results.map((r) => (expect(r, 201), r.body.deposit.id)));
    assert.equal(ids.size, 1);
    assert.equal((await customer.get(path)).body.length, 1);
  });

  test('the same webhook delivered concurrently is applied once', async () => {
    const customer = await newCustomer('webhook-race');
    const account = await openAccount(customer);
    const dep = await customer.post(`/v1/credit-accounts/${account.id}/collateral-deposits`, {
      amount: '25000',
    });
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'payment.succeeded' as const,
      reference: dep.body.paymentInstructions.reference,
      amount: '25000',
    };
    const acks = await Promise.all(Array.from({ length: 10 }, () => deliverPaymentEvent(event)));
    for (const ack of acks) expect(ack, 200);
    assert.equal(acks.filter((a) => !a.body.duplicate).length, 1);
    assert.equal(minor((await getAccount(customer, account.id)).collateral), 25_000n);
  });

  test('capture racing reversal: exactly one wins and the books agree', async () => {
    const { customer, account, token } = await activeCustomer(10_000, 'settle-race');
    const decision = await signedNetworkAuthorize(token, 3_000);
    const id = decision.body.authorizationId as string;
    const [c, r] = await Promise.all([capture(id), reverse(id)]);
    assert.equal(
      [c.status, r.status].filter((s) => s === 200).length,
      1,
      `capture ${c.status}, reverse ${r.status}`,
    );

    const a = await getAccount(customer, account.id);
    assert.equal(minor(a.heldAmount), 0n);
    assert.equal(minor(a.outstandingBalance), c.status === 200 ? 3_000n : 0n);
  });
});
