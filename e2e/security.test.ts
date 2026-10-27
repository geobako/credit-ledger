/** Every boundary rejects what it should. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  activeCustomer,
  authorize,
  config,
  deliverPaymentEvent,
  expect,
  http,
  newCustomer,
  openAccount,
} from './lib/stack.ts';

describe('security', () => {
  test('the API denies anonymous and forged callers', async () => {
    expect(await http(`${config.api}/v1/credit-accounts`), 401);
    const customer = await newCustomer('forged');
    const [h, p] = customer.token.split('.');
    const forged = `${h}.${p}.${'A'.repeat(86)}`;
    expect(
      await http(`${config.api}/v1/credit-accounts`, {
        headers: { authorization: `Bearer ${forged}` },
      }),
      401,
    );
  });

  test("a customer cannot see another customer's account", async () => {
    const alice = await newCustomer('owner');
    const mallory = await newCustomer('intruder');
    const account = await openAccount(alice);
    // Not found rather than forbidden: existence is not leaked.
    expect(await mallory.get(`/v1/credit-accounts/${account.id}`), 404);
    expect(
      await mallory.post(`/v1/credit-accounts/${account.id}/collateral-deposits`, {
        amount: '10000',
      }),
      404,
    );
    expect(await mallory.post(`/v1/credit-accounts/${account.id}/closure`, {}), 404);
  });

  test('customers cannot reach operations endpoints or charge off', async () => {
    const customer = await newCustomer('not-ops');
    expect(await customer.get('/v1/ops/reconciliation'), 403);
    const account = await openAccount(customer);
    expect(
      await customer.post(`/v1/credit-accounts/${account.id}/closure`, { reason: 'CHARGE_OFF' }),
      403,
    );
  });

  test('amounts must be integer minor-unit strings', async () => {
    const customer = await newCustomer('money');
    const account = await openAccount(customer);
    const path = `/v1/credit-accounts/${account.id}/collateral-deposits`;
    for (const amount of [100.5, '100.50', '-500', '1e5', 50_000]) {
      expect(await customer.post(path, { amount }), 400);
    }
  });

  test('webhooks need a valid, fresh signature', async () => {
    const event = { type: 'payment.succeeded' as const, reference: 'pay_x', amount: '100' };
    expect(
      await deliverPaymentEvent(event, { secret: 'not-the-real-secret-0123456789abcdef' }),
      401,
    );
    expect(
      await deliverPaymentEvent(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
      401,
    );
    expect(
      await http(`${config.api}/v1/webhooks/payments`, {
        body: { id: 'evt', type: 'payment.succeeded' },
      }),
      401,
    );
  });

  test('the internal network API only accepts the signed gateway', async () => {
    const path = '/v1/network/authorizations';
    const raw = JSON.stringify({
      networkTransactionId: 'e2e_unsigned_1',
      cardToken: `tok_${'0'.repeat(32)}`,
      amount: '100',
      currency: 'USD',
      merchantName: 'x',
    });
    expect(await http(`${config.api}${path}`, { raw }), 401);

    const t = Math.floor(Date.now() / 1000);
    // A valid signature for a different path must not be accepted here.
    const sig = createHmac('sha256', config.gatewaySecret)
      .update(`${t}\nPOST\n/v1/network/authorizations/x/reverse\n`)
      .update(raw)
      .digest('hex');
    expect(
      await http(`${config.api}${path}`, {
        raw,
        headers: { 'x-service-id': 'card-gateway', 'x-signature': `t=${t},v1=${sig}` },
      }),
      401,
    );
  });

  test('the gateway rejects unknown networks and malformed messages', async () => {
    expect(await authorize(`tok_${'0'.repeat(32)}`, 100, { key: 'wrong-network-key-123' }), 401);
    const bad = await authorize('not-a-token', 100);
    expect(bad, 400);
    assert.equal(bad.body.response_code, '30');
    const unknown = await authorize(`tok_${'0'.repeat(32)}`, 100);
    assert.equal(unknown.body.response_code, '14');
  });

  test('the gateway throttles card-testing bursts on one card', async () => {
    const { token } = await activeCustomer(10_000, 'card-testing');
    const codes = [];
    for (let i = 0; i < 15; i++) codes.push((await authorize(token, 100)).body.response_code);
    assert.ok(
      codes.includes('65'),
      `expected some 65 (frequency exceeded), got ${codes.join(',')}`,
    );
    assert.ok(
      codes.filter((c) => c === '00').length <= 10,
      'at most the burst allowance is approved',
    );
  });
});
