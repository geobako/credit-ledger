import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { isOps, Principal } from '../auth/principal';
import { ForbiddenError } from '../common/errors/domain-error';
import { Currency, Money } from '../common/money/money';
import { ENV, Env } from '../config/env';
import type { Database, Executor, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { isPgError, PgErrorCode } from '../database/pg-errors';
import { Card, cards, CreditAccount, creditAccounts, ledgerAccounts } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { IdempotencyService, IdempotentRequest } from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { issueVirtualCard } from './card-factory';
import {
  CreditAccountAlreadyOpenError,
  CreditAccountNotFoundError,
} from './credit-accounts.errors';

export interface CreditAccountView {
  id: string;
  customerId: string;
  status: CreditAccount['status'];
  currency: string;
  advanceRateBps: number;
  collateral: ReturnType<Money['toJSON']>;
  /** Overpayments owed back to the customer (returned at closure). */
  refundDue: ReturnType<Money['toJSON']>;
  creditLimit: ReturnType<Money['toJSON']>;
  outstandingBalance: ReturnType<Money['toJSON']>;
  heldAmount: ReturnType<Money['toJSON']>;
  availableCredit: ReturnType<Money['toJSON']>;
  card: {
    id: string;
    status: Card['status'];
    last4: string;
    expiryMonth: number;
    expiryYear: number;
  } | null;
  createdAt: Date;
  activatedAt: Date | null;
  closedAt: Date | null;
}

@Injectable()
export class CreditAccountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly tx: TransactionManager,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Opens a credit account with an inactive card; it activates once collateral is confirmed. */
  open(principal: Principal, idem: IdempotentRequest) {
    if (principal.role !== 'customer') {
      throw new ForbiddenError('only customers can open credit accounts');
    }
    return this.tx.run((tx) =>
      this.idempotency.execute(tx, idem, async () => {
        let account: CreditAccount;
        try {
          [account] = (await tx
            .insert(creditAccounts)
            .values({ customerId: principal.userId, advanceRateBps: this.env.ADVANCE_RATE_BPS })
            .returning()) as [CreditAccount];
        } catch (error) {
          if (
            isPgError(error, PgErrorCode.UniqueViolation, 'credit_accounts_one_open_per_customer')
          ) {
            throw new CreditAccountAlreadyOpenError('you already have an open credit account');
          }
          throw error;
        }
        await tx.insert(cards).values({ creditAccountId: account.id, ...issueVirtualCard() });
        await this.ledger.ensureAccount(tx, 'COLLATERAL_HELD', account.id);
        await this.ledger.ensureAccount(tx, 'CARD_RECEIVABLE', account.id);
        return { status: 201, body: await this.view(tx, account) };
      }),
    );
  }

  async list(principal: Principal): Promise<CreditAccountView[]> {
    const rows = await this.db
      .select()
      .from(creditAccounts)
      .where(isOps(principal) ? undefined : eq(creditAccounts.customerId, principal.userId))
      .orderBy(desc(creditAccounts.createdAt))
      .limit(100);
    return Promise.all(rows.map((row) => this.view(this.db, row)));
  }

  async get(principal: Principal, id: string): Promise<CreditAccountView> {
    return this.view(this.db, await this.findAccessible(this.db, principal, id));
  }

  /**
   * Loads an account the caller may see. Someone else's account is reported as not found,
   * so its existence is not leaked.
   */
  async findAccessible(db: Executor, principal: Principal, id: string): Promise<CreditAccount> {
    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(
        isOps(principal)
          ? eq(creditAccounts.id, id)
          : and(eq(creditAccounts.id, id), eq(creditAccounts.customerId, principal.userId)),
      );
    if (!account) throw new CreditAccountNotFoundError('credit account not found');
    return account;
  }

  /** Locks the account row: the serialisation point for every money movement on it. */
  async lock(tx: Transaction, id: string): Promise<CreditAccount> {
    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.id, id))
      .for('update');
    if (!account) throw new CreditAccountNotFoundError('credit account not found');
    return account;
  }

  async view(db: Executor, account: CreditAccount): Promise<CreditAccountView> {
    const currency = account.currency as Currency;
    const [card] = await db
      .select()
      .from(cards)
      .where(eq(cards.creditAccountId, account.id))
      .orderBy(desc(cards.createdAt))
      .limit(1);
    const balances = await db
      .select({ kind: ledgerAccounts.kind, balance: ledgerAccounts.balance })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.ownerId, account.id), eq(ledgerAccounts.currency, currency)));
    const ledgerBalance = (kind: string) =>
      Money.of(balances.find((b) => b.kind === kind)?.balance ?? 0n, currency).toJSON();

    const limit = Money.of(account.creditLimit, currency);
    const outstanding = Money.of(account.outstandingBalance, currency);
    const held = Money.of(account.heldAmount, currency);
    return {
      id: account.id,
      customerId: account.customerId,
      status: account.status,
      currency,
      advanceRateBps: account.advanceRateBps,
      collateral: ledgerBalance('COLLATERAL_HELD'),
      refundDue: ledgerBalance('REFUND_PAYABLE'),
      creditLimit: limit.toJSON(),
      outstandingBalance: outstanding.toJSON(),
      heldAmount: held.toJSON(),
      availableCredit: availableCredit(account).toJSON(),
      card: card
        ? {
            id: card.id,
            status: card.status,
            last4: card.last4,
            expiryMonth: card.expiryMonth,
            expiryYear: card.expiryYear,
          }
        : null,
      createdAt: account.createdAt,
      activatedAt: account.activatedAt,
      closedAt: account.closedAt,
    };
  }
}

/** limit − outstanding − holds. Never negative: the database CHECK guarantees it. */
export function availableCredit(account: CreditAccount): Money {
  const currency = account.currency as Currency;
  return Money.of(account.creditLimit, currency)
    .subtract(Money.of(account.outstandingBalance, currency))
    .subtract(Money.of(account.heldAmount, currency));
}
