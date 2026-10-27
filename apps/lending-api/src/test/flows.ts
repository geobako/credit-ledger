import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { creditAccounts } from '../database/schema';
import { LedgerService } from '../ledger/ledger.service';
import { ActiveAccount, TestApp } from './app';

/** Higher-level customer journeys used across integration specs. */
export function flows(t: TestApp) {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const settle = (reference: string, amount: string, type = 'payment.succeeded') =>
    t
      .deliverWebhook({
        id: `evt_${randomUUID()}`,
        type,
        data: { reference, amount, currency: 'USD' },
      })
      .expect(200);

  return {
    auth,
    settle,

    /** Authorize (and by default capture) a purchase through the signed network API. */
    async spend(a: ActiveAccount, amount: string, capture = true) {
      const res = await t
        .network('/authorizations', {
          networkTransactionId: `net:${randomUUID()}`,
          cardToken: a.cardToken,
          amount,
          currency: 'USD',
          merchantName: 'Test Merchant',
        })
        .expect(200);
      const decision = res.body as { authorizationId: string; approved: boolean };
      if (decision.approved && capture) {
        await t.network(`/authorizations/${decision.authorizationId}/capture`).expect(200);
      }
      return decision;
    },

    /** Starts a repayment; returns the provider reference to settle. */
    async startRepayment(a: ActiveAccount, amount: string) {
      const res = await t.http
        .post(`/v1/credit-accounts/${a.accountId}/repayments`)
        .set(auth(a.token))
        .set('Idempotency-Key', randomUUID())
        .send({ amount })
        .expect(201);
      return (res.body as { paymentInstructions: { reference: string } }).paymentInstructions
        .reference;
    },

    async repay(a: ActiveAccount, amount: string) {
      const reference = await this.startRepayment(a, amount);
      return settle(reference, amount);
    },

    close(a: ActiveAccount, token = a.token, body: object = {}) {
      return t.http
        .post(`/v1/credit-accounts/${a.accountId}/closure`)
        .set(auth(token))
        .set('Idempotency-Key', randomUUID())
        .send(body);
    },

    async account(a: ActiveAccount) {
      return (await t.http.get(`/v1/credit-accounts/${a.accountId}`).set(auth(a.token)).expect(200))
        .body as {
        status: string;
        creditLimit: { amount: string };
        outstandingBalance: { amount: string };
        heldAmount: { amount: string };
        availableCredit: { amount: string };
        collateral: { amount: string };
        refundDue: { amount: string };
        card: { status: string };
      };
    },

    /** Mirror columns agree with the ledger, and the whole ledger balances with no drift. */
    async expectBooksConsistent(a: ActiveAccount) {
      const ledger = t.app.get(LedgerService);
      const [row] = await t.db
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.id, a.accountId));
      const receivable = await t.db.execute<{ balance: string }>(
        sql`SELECT balance::text FROM ledger_accounts WHERE kind = 'CARD_RECEIVABLE' AND owner_id = ${a.accountId}`,
      );
      if (row!.status !== 'CLOSED') {
        expect(row!.outstandingBalance).toBe(BigInt(receivable.rows[0]!.balance));
      }
      expect((await ledger.trialBalance(t.db)).balanced).toBe(true);
      expect(await ledger.findBalanceDrift(t.db)).toEqual([]);
    },
  };
}
