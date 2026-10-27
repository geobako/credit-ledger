import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { Principal } from '../auth/principal';
import { Currency, Money, MoneyJson } from '../common/money/money';
import { ENV, Env } from '../config/env';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { Authorization, authorizations, cards, creditAccounts } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { hashRequest } from '../idempotency/request-hash';
import { transfer } from '../ledger/journal-entry';
import { LedgerService } from '../ledger/ledger.service';
import {
  AuthorizationNotFoundError,
  AuthorizationNotOpenError,
  CaptureExceedsAuthorizationError,
} from './authorizations.errors';
import { DeclineReason, declineReason } from './decline';

export interface AuthorizeRequest {
  networkTransactionId: string;
  cardToken: string;
  amount: Money;
  merchantName: string;
  merchantCategoryCode?: string;
}

export interface AuthorizationDecision {
  networkTransactionId: string;
  authorizationId: string | null;
  approved: boolean;
  status: 'HELD' | 'DECLINED';
  declineReason: DeclineReason | null;
  amount: MoneyJson;
}

/** Bigint → SQL bigint literal parameter (pg cannot bind a JS bigint inside raw SQL). */
const big = (value: bigint) => sql`${value.toString()}::bigint`;

/**
 * Card authorizations: the hot path. Every operation locks the credit account row first
 * (SELECT … FOR UPDATE), which serialises all money movement on that account. Two purchases
 * racing for the last dollar of credit are processed one after the other; the second sees
 * the first's hold. The database CHECK (outstanding + held <= limit) backs this up.
 */
@Injectable()
export class AuthorizationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly tx: TransactionManager,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: CreditAccountsService,
  ) {}

  /**
   * Approves (placing a hold) or declines a purchase. Idempotent on the network transaction id:
   * a retried request gets the original decision back, approved or declined.
   */
  async authorize(
    request: AuthorizeRequest,
  ): Promise<AuthorizationDecision & { replayed: boolean }> {
    const requestHash = hashRequest({
      method: 'AUTHORIZE',
      path: request.cardToken,
      body: {
        amount: request.amount.toJSON(),
        merchantName: request.merchantName,
        merchantCategoryCode: request.merchantCategoryCode ?? null,
      },
    });
    const result = await this.tx.run((tx) =>
      this.idempotency.execute(
        tx,
        { scope: 'network:authorize', key: request.networkTransactionId, requestHash },
        async () => ({ status: 200, body: await this.decide(tx, request) }),
      ),
    );
    return { ...result.body, replayed: result.replayed };
  }

  private async decide(tx: Transaction, request: AuthorizeRequest): Promise<AuthorizationDecision> {
    const decision = (
      authorizationId: string | null,
      reason: DeclineReason | null,
    ): AuthorizationDecision => ({
      networkTransactionId: request.networkTransactionId,
      authorizationId,
      approved: reason === null,
      status: reason === null ? 'HELD' : 'DECLINED',
      declineReason: reason,
      amount: request.amount.toJSON(),
    });

    const [found] = await tx
      .select({ id: cards.id, creditAccountId: cards.creditAccountId })
      .from(cards)
      .where(eq(cards.networkToken, request.cardToken));
    if (!found) return decision(null, 'CARD_NOT_FOUND');

    // Lock first, then read the card: freeze/unfreeze take the same account lock,
    // so the card status read here cannot change until this transaction commits.
    const account = await this.accounts.lock(tx, found.creditAccountId);
    const [card] = await tx.select().from(cards).where(eq(cards.id, found.id));
    const now = new Date();
    const reason = declineReason(account, card!, request.amount, now);

    const [auth] = await tx
      .insert(authorizations)
      .values({
        creditAccountId: account.id,
        cardId: card!.id,
        networkTransactionId: request.networkTransactionId,
        amount: request.amount.minor,
        currency: request.amount.currency,
        status: reason ? 'DECLINED' : 'HELD',
        declineReason: reason,
        merchantName: request.merchantName,
        merchantCategoryCode: request.merchantCategoryCode,
        expiresAt: new Date(now.getTime() + this.env.AUTH_HOLD_TTL_MINUTES * 60_000),
        resolvedAt: reason ? now : null,
      })
      .returning({ id: authorizations.id });

    if (!reason) {
      await tx
        .update(creditAccounts)
        .set({ heldAmount: sql`${creditAccounts.heldAmount} + ${big(request.amount.minor)}` })
        .where(eq(creditAccounts.id, account.id));
    }
    return decision(auth!.id, reason);
  }

  /**
   * The network settles the purchase: the hold becomes debt. Partial captures release the
   * remainder. Idempotent: re-capturing with the same amount returns the captured authorization.
   */
  capture(id: string, amount?: Money) {
    return this.tx.run(async (tx) => {
      const { account, auth } = await this.lockAuthorization(tx, id);
      const captureAmount = amount ?? Money.of(auth.amount, auth.currency as Currency);

      if (auth.status === 'CAPTURED' && auth.capturedAmount === captureAmount.minor) {
        return present(auth);
      }
      if (auth.status !== 'HELD') {
        throw new AuthorizationNotOpenError(
          `authorization is ${auth.status.toLowerCase()} and cannot be captured`,
        );
      }
      if (captureAmount.minor <= 0n || captureAmount.minor > auth.amount) {
        throw new CaptureExceedsAuthorizationError(
          'capture amount must be positive and at most the authorized amount',
          {
            authorized: Money.of(auth.amount, auth.currency as Currency).toJSON(),
          },
        );
      }

      const receivable = await this.ledger.ensureAccount(
        tx,
        'CARD_RECEIVABLE',
        account.id,
        captureAmount.currency,
      );
      const merchantPayable = await this.ledger.ensureAccount(
        tx,
        'MERCHANT_PAYABLE',
        null,
        captureAmount.currency,
      );
      const entry = await this.ledger.post(tx, {
        type: 'PURCHASE_CAPTURED',
        reference: `authorization:${auth.id}:captured`,
        description: `Purchase at ${auth.merchantName}`,
        metadata: { authorizationId: auth.id, creditAccountId: account.id },
        postings: transfer(receivable.id, merchantPayable.id, captureAmount),
      });

      await tx
        .update(creditAccounts)
        .set({
          heldAmount: sql`${creditAccounts.heldAmount} - ${big(auth.amount)}`,
          outstandingBalance: sql`${creditAccounts.outstandingBalance} + ${big(captureAmount.minor)}`,
        })
        .where(eq(creditAccounts.id, account.id));
      const [captured] = await tx
        .update(authorizations)
        .set({
          status: 'CAPTURED',
          capturedAmount: captureAmount.minor,
          journalEntryId: entry.id,
          resolvedAt: new Date(),
        })
        .where(eq(authorizations.id, auth.id))
        .returning();
      return present(captured!);
    });
  }

  /** The merchant cancels before settlement: the hold is released. Idempotent. */
  reverse(id: string) {
    return this.tx.run((tx) => this.release(tx, id, 'REVERSED'));
  }

  /** Releases holds the network never captured. Each one in its own short transaction. */
  async expireDue(now = new Date(), batchSize = 100): Promise<number> {
    const due = await this.db
      .select({ id: authorizations.id })
      .from(authorizations)
      .where(and(eq(authorizations.status, 'HELD'), lte(authorizations.expiresAt, now)))
      .limit(batchSize);
    let expired = 0;
    for (const { id } of due) {
      const result = await this.tx.run((tx) => this.release(tx, id, 'EXPIRED', now));
      if (result.status === 'EXPIRED') expired++;
    }
    return expired;
  }

  async listForAccount(principal: Principal, accountId: string, limit = 50) {
    const account = await this.accounts.findAccessible(this.db, principal, accountId);
    const rows = await this.db
      .select()
      .from(authorizations)
      .where(eq(authorizations.creditAccountId, account.id))
      .orderBy(desc(authorizations.createdAt))
      .limit(limit);
    return rows.map(present);
  }

  async get(id: string) {
    const [auth] = await this.db.select().from(authorizations).where(eq(authorizations.id, id));
    if (!auth) throw new AuthorizationNotFoundError('authorization not found');
    return auth;
  }

  private async release(
    tx: Transaction,
    id: string,
    status: 'REVERSED' | 'EXPIRED',
    expiringAt?: Date,
  ) {
    const { account, auth } = await this.lockAuthorization(tx, id);
    if (auth.status === status) return present(auth);
    if (auth.status !== 'HELD') {
      if (expiringAt) return present(auth); // resolved meanwhile: nothing to expire
      throw new AuthorizationNotOpenError(
        `authorization is ${auth.status.toLowerCase()} and cannot be reversed`,
      );
    }
    if (expiringAt && auth.expiresAt > expiringAt) return present(auth);

    await tx
      .update(creditAccounts)
      .set({ heldAmount: sql`${creditAccounts.heldAmount} - ${big(auth.amount)}` })
      .where(eq(creditAccounts.id, account.id));
    const [released] = await tx
      .update(authorizations)
      .set({ status, resolvedAt: new Date() })
      .where(eq(authorizations.id, auth.id))
      .returning();
    return present(released!);
  }

  /** Lock hierarchy: credit account, then the authorization. */
  private async lockAuthorization(tx: Transaction, id: string) {
    const [ref] = await tx
      .select({ creditAccountId: authorizations.creditAccountId })
      .from(authorizations)
      .where(eq(authorizations.id, id));
    if (!ref) throw new AuthorizationNotFoundError('authorization not found');
    const account = await this.accounts.lock(tx, ref.creditAccountId);
    const [auth] = await tx
      .select()
      .from(authorizations)
      .where(eq(authorizations.id, id))
      .for('update');
    return { account, auth: auth! };
  }
}

export function present(auth: Authorization) {
  const currency = auth.currency as Currency;
  return {
    id: auth.id,
    creditAccountId: auth.creditAccountId,
    cardId: auth.cardId,
    networkTransactionId: auth.networkTransactionId,
    status: auth.status,
    amount: Money.of(auth.amount, currency).toJSON(),
    capturedAmount:
      auth.capturedAmount === null ? null : Money.of(auth.capturedAmount, currency).toJSON(),
    declineReason: auth.declineReason,
    merchantName: auth.merchantName,
    merchantCategoryCode: auth.merchantCategoryCode,
    expiresAt: auth.expiresAt,
    createdAt: auth.createdAt,
    resolvedAt: auth.resolvedAt,
  };
}

export type AuthorizationView = ReturnType<typeof present>;
