import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Principal } from '../auth/principal';
import { Currency, Money } from '../common/money/money';
import { ENV, Env } from '../config/env';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { cards, CollateralDeposit, collateralDeposits, creditAccounts } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { CreditAccountClosedError } from '../credit-accounts/credit-accounts.errors';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import { DomainEvents } from '../events/domain-events';
import { IdempotencyService, IdempotentRequest } from '../idempotency/idempotency.service';
import { transfer } from '../ledger/journal-entry';
import { LedgerService } from '../ledger/ledger.service';
import { DepositOutOfRangeError } from './collateral.errors';

export interface PaymentSettlement {
  reference: string;
  outcome: 'succeeded' | 'failed';
  amount: Money;
  failureReason?: string;
}

export type SettlementOutcome =
  | 'CONFIRMED'
  | 'FAILED'
  | 'REJECTED_AMOUNT_MISMATCH'
  | 'REJECTED_ACCOUNT_CLOSED'
  | 'ALREADY_SETTLED'
  | 'UNKNOWN_REFERENCE';

export const SANDBOX_PROVIDER = 'sandbox-pay';

@Injectable()
export class CollateralService {
  private readonly logger = new Logger(CollateralService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly tx: TransactionManager,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: CreditAccountsService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Registers an expected collateral transfer. Nothing is credited yet: collateral only
   * counts once the payment provider confirms the funds arrived (signed webhook).
   */
  createDeposit(principal: Principal, accountId: string, amount: Money, idem: IdempotentRequest) {
    const min = Money.of(this.env.MIN_DEPOSIT_MINOR, amount.currency);
    const max = Money.of(this.env.MAX_DEPOSIT_MINOR, amount.currency);
    if (amount.lt(min) || amount.gt(max)) {
      throw new DepositOutOfRangeError(
        `collateral deposits must be between ${min.toString()} and ${max.toString()}`,
        { min: min.toJSON(), max: max.toJSON() },
      );
    }
    return this.tx.run((tx) =>
      this.idempotency.execute(tx, idem, async () => {
        const account = await this.accounts.findAccessible(tx, principal, accountId);
        if (account.status === 'CLOSED') {
          throw new CreditAccountClosedError('this credit account is closed');
        }
        const [deposit] = await tx
          .insert(collateralDeposits)
          .values({
            creditAccountId: account.id,
            amount: amount.minor,
            currency: amount.currency,
            providerReference: `pay_${randomUUID().replace(/-/g, '')}`,
          })
          .returning();
        await this.events.emit(tx, {
          type: 'CollateralDepositRequested',
          entityType: 'collateral_deposit',
          entityId: deposit!.id,
          creditAccountId: account.id,
          data: { depositId: deposit!.id, amount: amount.toJSON() },
        });
        return {
          status: 201,
          body: {
            deposit: present(deposit!),
            paymentInstructions: {
              provider: SANDBOX_PROVIDER,
              reference: deposit!.providerReference,
              amount: amount.toJSON(),
              note: 'Transfer this exact amount quoting the reference. The card activates once the funds are confirmed.',
            },
          },
        };
      }),
    );
  }

  async list(principal: Principal, accountId: string) {
    const account = await this.accounts.findAccessible(this.db, principal, accountId);
    const rows = await this.db
      .select()
      .from(collateralDeposits)
      .where(eq(collateralDeposits.creditAccountId, account.id))
      .orderBy(desc(collateralDeposits.createdAt));
    return rows.map(present);
  }

  async findByReference(reference: string): Promise<CollateralDeposit | undefined> {
    const [deposit] = await this.db
      .select()
      .from(collateralDeposits)
      .where(eq(collateralDeposits.providerReference, reference));
    return deposit;
  }

  /**
   * Applies a payment provider's verdict on a deposit, inside the caller's transaction.
   * Confirmation credits the collateral in the ledger, raises the credit limit (derived from
   * the ledger's collateral balance, not from a running sum) and activates the account and card.
   */
  async settle(tx: Transaction, settlement: PaymentSettlement): Promise<SettlementOutcome> {
    const [found] = await tx
      .select({ id: collateralDeposits.id, creditAccountId: collateralDeposits.creditAccountId })
      .from(collateralDeposits)
      .where(eq(collateralDeposits.providerReference, settlement.reference));
    if (!found) return 'UNKNOWN_REFERENCE';

    // Lock hierarchy: credit account first, then the deposit.
    const account = await this.accounts.lock(tx, found.creditAccountId);
    const [deposit] = await tx
      .select()
      .from(collateralDeposits)
      .where(eq(collateralDeposits.id, found.id))
      .for('update');
    if (!deposit || deposit.status !== 'PENDING') return 'ALREADY_SETTLED';

    const reject = async (status: 'FAILED' | 'REJECTED', reason: string) => {
      await tx
        .update(collateralDeposits)
        .set({ status, failureReason: reason, settledAt: new Date() })
        .where(eq(collateralDeposits.id, deposit.id));
      await this.events.emit(tx, {
        type: status === 'FAILED' ? 'CollateralDepositFailed' : 'CollateralDepositRejected',
        entityType: 'collateral_deposit',
        entityId: deposit.id,
        creditAccountId: account.id,
        data: { depositId: deposit.id, reason, amountReceived: settlement.amount.toJSON() },
      });
    };

    if (settlement.outcome === 'failed') {
      await reject('FAILED', settlement.failureReason ?? 'PAYMENT_FAILED');
      return 'FAILED';
    }
    const expected = Money.of(deposit.amount, deposit.currency as Currency);
    if (!settlement.amount.equals(expected)) {
      // Funds arrived but not as agreed: never guess. Hold for operations to refund.
      this.logger.warn({ depositId: deposit.id }, 'collateral amount mismatch');
      await reject('REJECTED', 'AMOUNT_MISMATCH');
      return 'REJECTED_AMOUNT_MISMATCH';
    }
    if (account.status === 'CLOSED') {
      await reject('REJECTED', 'ACCOUNT_CLOSED');
      return 'REJECTED_ACCOUNT_CLOSED';
    }

    const collateralHeld = await this.ledger.ensureAccount(
      tx,
      'COLLATERAL_HELD',
      account.id,
      expected.currency,
    );
    const collateralCash = await this.ledger.ensureAccount(
      tx,
      'COLLATERAL_CASH',
      null,
      expected.currency,
    );
    const entry = await this.ledger.post(tx, {
      type: 'COLLATERAL_CONFIRMED',
      reference: `collateral-deposit:${deposit.id}:confirmed`,
      description: `Collateral deposit ${settlement.reference} confirmed`,
      metadata: { depositId: deposit.id, creditAccountId: account.id },
      postings: transfer(collateralCash.id, collateralHeld.id, expected),
    });

    const collateral = await this.ledger.balanceOf(tx, collateralHeld.id);
    const creditLimit = collateral.applyBasisPoints(account.advanceRateBps);
    const now = new Date();
    await tx
      .update(creditAccounts)
      .set({
        creditLimit: creditLimit.minor,
        status: 'ACTIVE',
        activatedAt: sql`coalesce(${creditAccounts.activatedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(eq(creditAccounts.id, account.id));
    await tx
      .update(cards)
      .set({ status: 'ACTIVE', activatedAt: now })
      .where(and(eq(cards.creditAccountId, account.id), eq(cards.status, 'INACTIVE')));
    await tx
      .update(collateralDeposits)
      .set({ status: 'CONFIRMED', journalEntryId: entry.id, settledAt: now })
      .where(eq(collateralDeposits.id, deposit.id));

    await this.events.emit(tx, {
      type: 'CollateralDepositConfirmed',
      entityType: 'collateral_deposit',
      entityId: deposit.id,
      creditAccountId: account.id,
      data: {
        depositId: deposit.id,
        amount: expected.toJSON(),
        journalEntryId: entry.id,
        collateral: collateral.toJSON(),
      },
    });
    await this.events.emit(tx, {
      type: 'CreditLimitChanged',
      entityType: 'credit_account',
      entityId: account.id,
      creditAccountId: account.id,
      data: {
        previous: Money.of(account.creditLimit, expected.currency).toJSON(),
        current: creditLimit.toJSON(),
        advanceRateBps: account.advanceRateBps,
      },
    });
    if (account.status === 'PENDING_COLLATERAL') {
      await this.events.emit(tx, {
        type: 'CreditAccountActivated',
        entityType: 'credit_account',
        entityId: account.id,
        creditAccountId: account.id,
        data: { creditLimit: creditLimit.toJSON() },
      });
    }
    return 'CONFIRMED';
  }
}

export function present(deposit: CollateralDeposit) {
  return {
    id: deposit.id,
    creditAccountId: deposit.creditAccountId,
    amount: Money.of(deposit.amount, deposit.currency as Currency).toJSON(),
    status: deposit.status,
    providerReference: deposit.providerReference,
    failureReason: deposit.failureReason,
    createdAt: deposit.createdAt,
    settledAt: deposit.settledAt,
  };
}
