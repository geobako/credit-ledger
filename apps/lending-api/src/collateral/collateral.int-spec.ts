import { randomUUID } from 'node:crypto';
import { createTestApp, idemKey, TestApp } from '../test/app';

interface AccountBody {
  id: string;
  status: string;
  creditLimit: { amount: string };
  availableCredit: { amount: string };
  collateral: { amount: string };
  card: { status: string; last4: string };
}

describe('collateral → activation flow (HTTP)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function openAccount(token: string): Promise<AccountBody> {
    const res = await t.http
      .post('/v1/credit-accounts')
      .set(auth(token))
      .set('Idempotency-Key', idemKey())
      .expect(201);
    return res.body as AccountBody;
  }

  async function startDeposit(token: string, accountId: string, amount = '50000') {
    const res = await t.http
      .post(`/v1/credit-accounts/${accountId}/collateral-deposits`)
      .set(auth(token))
      .set('Idempotency-Key', idemKey())
      .send({ amount })
      .expect(201);
    return res.body as {
      deposit: { id: string; status: string };
      paymentInstructions: { reference: string };
    };
  }

  const paymentEvent = (reference: string, amount = '50000', type = 'payment.succeeded') => ({
    id: `evt_${randomUUID()}`,
    type,
    data: { reference, amount, currency: 'USD' },
  });

  const getAccount = async (token: string, id: string) =>
    (await t.http.get(`/v1/credit-accounts/${id}`).set(auth(token)).expect(200))
      .body as AccountBody;

  it('opens an account with an inactive card and no credit', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    expect(account).toMatchObject({
      status: 'PENDING_COLLATERAL',
      creditLimit: { amount: '0', currency: 'USD' },
      availableCredit: { amount: '0', currency: 'USD' },
      card: { status: 'INACTIVE' },
    });
    expect(account.card.last4).toMatch(/^\d{4}$/);
  });

  it('activates the card with a limit derived from collateral once the payment is confirmed', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    const { deposit, paymentInstructions } = await startDeposit(token, account.id, '50000');
    expect(deposit.status).toBe('PENDING');

    // Not active until the money is confirmed.
    expect((await getAccount(token, account.id)).status).toBe('PENDING_COLLATERAL');

    const ack = await t.deliverWebhook(paymentEvent(paymentInstructions.reference)).expect(200);
    expect(ack.body).toEqual({ received: true, duplicate: false, outcome: 'CONFIRMED' });

    expect(await getAccount(token, account.id)).toMatchObject({
      status: 'ACTIVE',
      collateral: { amount: '50000' },
      creditLimit: { amount: '50000' },
      availableCredit: { amount: '50000' },
      card: { status: 'ACTIVE' },
    });
  });

  it('raises the limit with additional deposits', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    for (const amount of ['50000', '25050']) {
      const { paymentInstructions } = await startDeposit(token, account.id, amount);
      await t.deliverWebhook(paymentEvent(paymentInstructions.reference, amount)).expect(200);
    }
    expect((await getAccount(token, account.id)).creditLimit.amount).toBe('75050');
  });

  it('processes a redelivered event once', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    const { paymentInstructions } = await startDeposit(token, account.id);
    const event = paymentEvent(paymentInstructions.reference);

    await t.deliverWebhook(event).expect(200);
    const again = await t.deliverWebhook(event).expect(200);
    expect(again.body).toEqual({ received: true, duplicate: true, outcome: 'CONFIRMED' });
    expect((await getAccount(token, account.id)).collateral.amount).toBe('50000');
  });

  it('credits collateral once when the provider fires the same event and a second event concurrently', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    const { paymentInstructions } = await startDeposit(token, account.id);
    const event = paymentEvent(paymentInstructions.reference);
    const otherEventSameDeposit = paymentEvent(paymentInstructions.reference);

    const responses = await Promise.all([
      ...Array.from({ length: 8 }, () => t.deliverWebhook(event)),
      ...Array.from({ length: 4 }, () => t.deliverWebhook(otherEventSameDeposit)),
    ]);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const outcomes = responses.map((r) => (r.body as { outcome: string }).outcome);
    expect(outcomes.filter((o) => o === 'CONFIRMED').length).toBeGreaterThanOrEqual(1);
    expect((await getAccount(token, account.id)).collateral.amount).toBe('50000');
  });

  it('rejects a payment whose amount differs from the deposit, without crediting anything', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    const { paymentInstructions } = await startDeposit(token, account.id, '50000');

    const ack = await t
      .deliverWebhook(paymentEvent(paymentInstructions.reference, '49999'))
      .expect(200);
    expect((ack.body as { outcome: string }).outcome).toBe('REJECTED_AMOUNT_MISMATCH');
    const view = await getAccount(token, account.id);
    expect(view).toMatchObject({ status: 'PENDING_COLLATERAL', collateral: { amount: '0' } });

    const deposits = await t.http
      .get(`/v1/credit-accounts/${account.id}/collateral-deposits`)
      .set(auth(token))
      .expect(200);
    expect(deposits.body).toEqual([
      expect.objectContaining({ status: 'REJECTED', failureReason: 'AMOUNT_MISMATCH' }),
    ]);
  });

  it('marks a failed payment as failed and keeps the card inactive', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    const { paymentInstructions } = await startDeposit(token, account.id);
    const ack = await t
      .deliverWebhook(paymentEvent(paymentInstructions.reference, '50000', 'payment.failed'))
      .expect(200);
    expect((ack.body as { outcome: string }).outcome).toBe('FAILED');
    expect((await getAccount(token, account.id)).card.status).toBe('INACTIVE');
  });

  it.each([
    ['a bad signature', { signature: 't=1,v1=' + '0'.repeat(64) }],
    ['no signature', { signature: '' }],
  ])('refuses webhooks with %s', async (_label, options) => {
    const res = await t.deliverWebhook(paymentEvent('pay_x'), options).expect(401);
    expect(res.body).toMatchObject({ code: 'INVALID_WEBHOOK_SIGNATURE' });
  });

  it('acknowledges events for unknown references without side effects', async () => {
    const ack = await t.deliverWebhook(paymentEvent('pay_does_not_exist')).expect(200);
    expect((ack.body as { outcome: string }).outcome).toBe('UNKNOWN_REFERENCE');
  });

  it('settles through the sandbox simulator (same signed path)', async () => {
    const token = await t.newCustomer();
    const account = await openAccount(token);
    const { paymentInstructions } = await startDeposit(token, account.id, '12345');
    const res = await t.http
      .post(`/v1/sandbox/payments/${paymentInstructions.reference}/settle`)
      .set(auth(token))
      .send({ outcome: 'succeeded' })
      .expect(200);
    expect(res.body).toMatchObject({ ack: { outcome: 'CONFIRMED' } });
    expect((await getAccount(token, account.id)).creditLimit.amount).toBe('12345');
  });

  describe('deposit requests', () => {
    it('replays an idempotent deposit request instead of creating a second one', async () => {
      const token = await t.newCustomer();
      const account = await openAccount(token);
      const key = idemKey();
      const send = () =>
        t.http
          .post(`/v1/credit-accounts/${account.id}/collateral-deposits`)
          .set(auth(token))
          .set('Idempotency-Key', key)
          .send({ amount: '50000' });

      const first = await send().expect(201);
      const second = await send().expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);

      const reused = await t.http
        .post(`/v1/credit-accounts/${account.id}/collateral-deposits`)
        .set(auth(token))
        .set('Idempotency-Key', key)
        .send({ amount: '60000' })
        .expect(422);
      expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

      const deposits = await t.http
        .get(`/v1/credit-accounts/${account.id}/collateral-deposits`)
        .set(auth(token));
      expect(deposits.body).toHaveLength(1);
    });

    it('requires an Idempotency-Key', async () => {
      const token = await t.newCustomer();
      const account = await openAccount(token);
      await t.http
        .post(`/v1/credit-accounts/${account.id}/collateral-deposits`)
        .set(auth(token))
        .send({ amount: '50000' })
        .expect(400);
    });

    it.each([
      ['below the minimum', '4999', 400],
      ['above the maximum', '1000001', 400],
      ['fractional', '100.50', 400],
      ['a JSON number', 50000, 400],
      ['negative', '-5000', 400],
    ])('rejects amounts %s', async (_label, amount, status) => {
      const token = await t.newCustomer();
      const account = await openAccount(token);
      await t.http
        .post(`/v1/credit-accounts/${account.id}/collateral-deposits`)
        .set(auth(token))
        .set('Idempotency-Key', idemKey())
        .send({ amount })
        .expect(status);
    });
  });
});
