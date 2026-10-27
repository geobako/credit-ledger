import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { creditAccounts } from '../database/schema';
import { findPgError } from '../database/pg-errors';
import { LedgerService } from '../ledger/ledger.service';
import { signRequest } from '../common/security/request-signature';
import { ActiveAccount, createTestApp, TEST_GATEWAY_SECRET, TestApp } from '../test/app';
import { AuthorizationsService } from './authorizations.service';

interface Decision {
  authorizationId: string | null;
  approved: boolean;
  status: string;
  declineReason: string | null;
}

interface AccountView {
  creditLimit: { amount: string };
  outstandingBalance: { amount: string };
  heldAmount: { amount: string };
  availableCredit: { amount: string };
}

describe('purchase authorizations (HTTP + Postgres)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const authorize = (
    a: ActiveAccount,
    amount: string,
    networkTransactionId = `net:${randomUUID()}`,
  ) =>
    t.network('/authorizations', {
      networkTransactionId,
      cardToken: a.cardToken,
      amount,
      currency: 'USD',
      merchantName: 'Test Merchant',
      merchantCategoryCode: '5411',
    });

  const view = async (a: ActiveAccount) =>
    (await t.http.get(`/v1/credit-accounts/${a.accountId}`).set(auth(a.token)).expect(200))
      .body as AccountView;

  /** The invariants that must hold for any account at any time. */
  async function expectConsistent(a: ActiveAccount) {
    const [row] = await t.db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.id, a.accountId));
    const holds = await t.db.execute<{ held: string; captured: string }>(sql`
      SELECT coalesce(sum(amount) FILTER (WHERE status = 'HELD'), 0)::text AS held,
             coalesce(sum(captured_amount) FILTER (WHERE status = 'CAPTURED'), 0)::text AS captured
        FROM authorizations WHERE credit_account_id = ${a.accountId}`);
    const ledger = t.app.get(LedgerService);
    const receivable = await t.db.execute<{ id: string }>(
      sql`SELECT id FROM ledger_accounts WHERE kind = 'CARD_RECEIVABLE' AND owner_id = ${a.accountId}`,
    );
    const receivableBalance = await ledger.balanceOf(t.db, receivable.rows[0]!.id);

    expect(row!.heldAmount).toBe(BigInt(holds.rows[0]!.held));
    expect(row!.outstandingBalance).toBe(BigInt(holds.rows[0]!.captured));
    expect(row!.outstandingBalance).toBe(receivableBalance.minor);
    expect(row!.outstandingBalance + row!.heldAmount).toBeLessThanOrEqual(row!.creditLimit);
  }

  it('holds credit on approval and turns it into debt on capture', async () => {
    const a = await t.activeAccount('50000');
    const decision = (await authorize(a, '1250').expect(200)).body as Decision;
    expect(decision).toMatchObject({ approved: true, status: 'HELD', declineReason: null });

    expect(await view(a)).toMatchObject({
      heldAmount: { amount: '1250' },
      availableCredit: { amount: '48750' },
    });

    const captured = await t
      .network(`/authorizations/${decision.authorizationId}/capture`)
      .expect(200);
    expect(captured.body).toMatchObject({ status: 'CAPTURED', capturedAmount: { amount: '1250' } });
    expect(await view(a)).toMatchObject({
      heldAmount: { amount: '0' },
      outstandingBalance: { amount: '1250' },
      availableCredit: { amount: '48750' },
    });
    await expectConsistent(a);
  });

  it('declines a purchase over the available credit and records it', async () => {
    const a = await t.activeAccount('10000');
    const decision = (await authorize(a, '10001').expect(200)).body as Decision;
    expect(decision).toMatchObject({
      approved: false,
      status: 'DECLINED',
      declineReason: 'INSUFFICIENT_CREDIT',
    });

    const history = await t.http
      .get(`/v1/credit-accounts/${a.accountId}/authorizations`)
      .set(auth(a.token))
      .expect(200);
    expect(history.body).toEqual([
      expect.objectContaining({ status: 'DECLINED', declineReason: 'INSUFFICIENT_CREDIT' }),
    ]);
    expect((await view(a)).availableCredit.amount).toBe('10000');
  });

  it('approves exactly the affordable purchases when 100 race for the same card', async () => {
    const a = await t.activeAccount('50000'); // $500 limit
    const results = await Promise.all(Array.from({ length: 100 }, () => authorize(a, '1000'))); // $10 each
    const decisions = results.map((r) => r.body as Decision);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(decisions.filter((d) => d.approved)).toHaveLength(50);
    expect(decisions.filter((d) => d.declineReason === 'INSUFFICIENT_CREDIT')).toHaveLength(50);
    expect(await view(a)).toMatchObject({
      heldAmount: { amount: '50000' },
      availableCredit: { amount: '0' },
    });
    await expectConsistent(a);
  });

  it('keeps every invariant under a random concurrent mix of purchases, captures and reversals', async () => {
    const a = await t.activeAccount('50000');
    const amount = () => String(1 + Math.floor(Math.random() * 5_000));

    const first = await Promise.all(Array.from({ length: 40 }, () => authorize(a, amount())));
    const approved = first.map((r) => r.body as Decision).filter((d) => d.approved);

    await Promise.all([
      ...approved.map((d, i) =>
        i % 3 === 0
          ? t.network(`/authorizations/${d.authorizationId}/reverse`)
          : t.network(`/authorizations/${d.authorizationId}/capture`),
      ),
      ...Array.from({ length: 20 }, () => authorize(a, amount())),
    ]);
    await expectConsistent(a);
  });

  it('is idempotent on the network transaction id, even under concurrent retries', async () => {
    const a = await t.activeAccount('50000');
    const id = `net:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => authorize(a, '2000', id)));
    const ids = new Set(results.map((r) => (r.body as Decision).authorizationId));

    expect(ids.size).toBe(1);
    expect((await view(a)).heldAmount.amount).toBe('2000');

    const reused = await authorize(a, '9999', id).expect(422);
    expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('lets exactly one of a concurrent capture and reversal win', async () => {
    const a = await t.activeAccount('50000');
    const { authorizationId } = (await authorize(a, '3000')).body as Decision;
    const [capture, reverse] = await Promise.all([
      t.network(`/authorizations/${authorizationId}/capture`),
      t.network(`/authorizations/${authorizationId}/reverse`),
    ]);
    expect([capture.status, reverse.status].sort()).toEqual([200, 409]);
    await expectConsistent(a);
  });

  it('supports idempotent and partial captures but never over-capture', async () => {
    const a = await t.activeAccount('50000');
    const { authorizationId } = (await authorize(a, '4000')).body as Decision;

    await t.network(`/authorizations/${authorizationId}/capture`, { amount: '4001' }).expect(422);
    await t.network(`/authorizations/${authorizationId}/capture`, { amount: '3500' }).expect(200);
    await t.network(`/authorizations/${authorizationId}/capture`, { amount: '3500' }).expect(200);
    await t.network(`/authorizations/${authorizationId}/capture`, { amount: '3000' }).expect(409);

    expect(await view(a)).toMatchObject({
      heldAmount: { amount: '0' },
      outstandingBalance: { amount: '3500' },
      availableCredit: { amount: '46500' },
    });
    await expectConsistent(a);
  });

  it('declines on a frozen card while earlier holds still settle', async () => {
    const a = await t.activeAccount('50000');
    const before = (await authorize(a, '1000')).body as Decision;

    await t.http.post(`/v1/cards/${a.cardId}/freeze`).set(auth(a.token)).expect(200);
    await t.http.post(`/v1/cards/${a.cardId}/freeze`).set(auth(a.token)).expect(200); // idempotent
    expect(((await authorize(a, '1000')).body as Decision).declineReason).toBe('CARD_FROZEN');
    await t.network(`/authorizations/${before.authorizationId}/capture`).expect(200);

    await t.http.post(`/v1/cards/${a.cardId}/unfreeze`).set(auth(a.token)).expect(200);
    expect(((await authorize(a, '1000')).body as Decision).approved).toBe(true);
  });

  it("does not let a stranger freeze someone else's card", async () => {
    const a = await t.activeAccount('50000');
    const stranger = await t.newCustomer();
    await t.http.post(`/v1/cards/${a.cardId}/freeze`).set(auth(stranger)).expect(404);
  });

  it('releases holds that are never captured', async () => {
    const a = await t.activeAccount('50000');
    const { authorizationId } = (await authorize(a, '7000')).body as Decision;
    const service = t.app.get(AuthorizationsService);

    expect(await service.expireDue(new Date())).toBe(0); // not due yet
    const eightDays = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    expect(await service.expireDue(eightDays)).toBeGreaterThanOrEqual(1);

    expect((await view(a)).availableCredit.amount).toBe('50000');
    await t.network(`/authorizations/${authorizationId}/capture`).expect(409);
    await expectConsistent(a);
  });

  it('declines cards that are not usable yet or unknown', async () => {
    const token = await t.newCustomer();
    const account = await t.http
      .post('/v1/credit-accounts')
      .set(auth(token))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const accountId = (account.body as { id: string }).id;
    const card = await t.db.execute<{ network_token: string }>(
      sql`SELECT network_token FROM cards WHERE credit_account_id = ${accountId}`,
    );
    const pending = { token, accountId, cardId: '', cardToken: card.rows[0]!.network_token };

    expect(((await authorize(pending, '100')).body as Decision).declineReason).toBe(
      'CARD_INACTIVE',
    );
    expect(
      (
        (await authorize({ ...pending, cardToken: `tok_${'0'.repeat(32)}` }, '100'))
          .body as Decision
      ).declineReason,
    ).toBe('CARD_NOT_FOUND');
  });

  describe('network API authentication', () => {
    const body = {
      networkTransactionId: 'net:unsigned-1',
      cardToken: `tok_${'0'.repeat(32)}`,
      amount: '1',
      currency: 'USD',
      merchantName: 'x',
    };

    it('rejects unsigned calls and user tokens', async () => {
      await t.http.post('/v1/network/authorizations').send(body).expect(401);
      const user = await t.newCustomer();
      await t.http.post('/v1/network/authorizations').set(auth(user)).send(body).expect(401);
    });

    it('rejects a signature made for another endpoint', async () => {
      const a = await t.activeAccount('50000');
      const { authorizationId } = (await authorize(a, '100')).body as Decision;
      const capturePath = `/v1/network/authorizations/${authorizationId}/capture`;
      const signedForCapture = signRequest(TEST_GATEWAY_SECRET, 'POST', capturePath, '');
      const replayed = await t.http
        .post(`/v1/network/authorizations/${authorizationId}/reverse`)
        .set('X-Service-Id', 'card-gateway')
        .set('X-Signature', signedForCapture)
        .expect(401);
      expect(replayed.body).toMatchObject({ code: 'INVALID_SERVICE_SIGNATURE' });

      // The same signature is valid where it was meant to be used.
      await t.http
        .post(capturePath)
        .set('X-Service-Id', 'card-gateway')
        .set('X-Signature', signedForCapture)
        .expect(200);
    });
  });

  it('is backed by the database: holds beyond the limit are impossible even for buggy code', async () => {
    const a = await t.activeAccount('10000');
    let code: string | undefined;
    try {
      await t.db
        .update(creditAccounts)
        .set({ heldAmount: 10_001n })
        .where(eq(creditAccounts.id, a.accountId));
    } catch (error) {
      code = findPgError(error)?.code;
    }
    expect(code).toBe('23514');
  });
});
