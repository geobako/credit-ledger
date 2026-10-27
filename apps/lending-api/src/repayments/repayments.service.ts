import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { Principal } from '../auth/principal';
import { Currency, Money } from '../common/money/money';
import { CreditAccountClosedError } from '../credit-accounts/credit-accounts.errors';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { creditAccounts, Repayment, repayments } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { DomainEvents } from '../events/domain-events';
import { IdempotencyService, IdempotentRequest } from '../idempotency/idempotency.service';
import { PostingInput } from '../ledger/journal-entry';
import { LedgerService } from '../ledger/ledger.service';
import { NothingToRepayError, RepaymentExceedsBalanceError } from './repayments.errors';

export type RepaymentOutcome =
  | 'SETTLED'
  | 'FAILED'
  | 'REJECTED_AMOUNT_MISMATCH'
  | 'REJECTED_ACCOUNT_CLOSED'
  | 'ALREADY_SETTLED'
  | 'UNKNOWN_REFERENCE';

export interface RepaymentSettlement {
  reference: string;
  outcome: 'succeeded' | 'failed';
  amount: Money;
  failureReason?: string;
}

/**
 * Customers paying back what they spent. Like collateral, a repayment only counts once the
 * payment provider confirms the funds; settling it reduces the debt and so restores
 * available credit.
 */
@Injectable()
export class RepaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tx: TransactionManager,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: CreditAccountsService,
    private readonly events: DomainEvents,
  ) {}

  create(principal: Principal, accountId: string, amount: Money, idem: IdempotentRequest) {
    return this.tx.run((tx) =>
      this.idempotency.execute(tx, idem, async () => {
        const account = await this.accounts.findAccessible(tx, principal, accountId);
        if (account.status === 'CLOSED')
          throw new CreditAccountClosedError('this credit account is closed');
        const outstanding = Money.of(account.outstandingBalance, account.currency as Currency);
        if (outstanding.isZero())
          throw new NothingToRepayError('there is no outstanding balance to repay');
        if (amount.gt(outstanding)) {
          throw new RepaymentExceedsBalanceError(
            `you can repay at most ${outstanding.toString()}`,
            {
              outstanding: outstanding.toJSON(),
            },
          );
        }
        const [repayment] = await tx
          .insert(repayments)
          .values({
            creditAccountId: account.id,
            amount: amount.minor,
            currency: amount.currency,
            providerReference: `rpy_${randomUUID().replace(/-/g, '')}`,
          })
          .returning();
        await this.events.emit(tx, {
          type: 'RepaymentRequested',
          entityType: 'repayment',
          entityId: repayment!.id,
          creditAccountId: account.id,
          data: { repaymentId: repayment!.id, amount: amount.toJSON() },
        });
        return {
          status: 201,
          body: {
            repayment: present(repayment!),
            paymentInstructions: {
              provider: 'sandbox-pay',
              reference: repayment!.providerReference,
              amount: amount.toJSON(),
              note: 'Transfer this exact amount quoting the reference. Your available credit is restored once the payment settles.',
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
      .from(repayments)
      .where(eq(repayments.creditAccountId, account.id))
      .orderBy(desc(repayments.createdAt));
    return rows.map(present);
  }

  async findByReference(reference: string): Promise<Repayment | undefined> {
    const [repayment] = await this.db
      .select()
      .from(repayments)
      .where(eq(repayments.providerReference, reference));
    return repayment;
  }

  /**
   * Applies a confirmed payment. Validation at creation caps it at the debt, but debt can
   * shrink before the money lands (another repayment settled first). Whatever exceeds the
   * debt at settlement is never lost: it is booked as a refund owed to the customer.
   */
  async settle(tx: Transaction, settlement: RepaymentSettlement): Promise<RepaymentOutcome> {
    const [found] = await tx
      .select({ id: repayments.id, creditAccountId: repayments.creditAccountId })
      .from(repayments)
      .where(eq(repayments.providerReference, settlement.reference));
    if (!found) return 'UNKNOWN_REFERENCE';

    const account = await this.accounts.lock(tx, found.creditAccountId);
    const [repayment] = await tx
      .select()
      .from(repayments)
      .where(eq(repayments.id, found.id))
      .for('update');
    if (!repayment || repayment.status !== 'PENDING') return 'ALREADY_SETTLED';

    const reject = async (status: 'FAILED' | 'REJECTED', reason: string) => {
      await tx
        .update(repayments)
        .set({ status, failureReason: reason, settledAt: new Date() })
        .where(eq(repayments.id, repayment.id));
      await this.events.emit(tx, {
        type: status === 'FAILED' ? 'RepaymentFailed' : 'RepaymentRejected',
        entityType: 'repayment',
        entityId: repayment.id,
        creditAccountId: account.id,
        data: { repaymentId: repayment.id, reason, amountReceived: settlement.amount.toJSON() },
      });
    };

    if (settlement.outcome === 'failed') {
      await reject('FAILED', settlement.failureReason ?? 'PAYMENT_FAILED');
      return 'FAILED';
    }
    const currency = repayment.currency as Currency;
    const amount = Money.of(repayment.amount, currency);
    if (!settlement.amount.equals(amount)) {
      await reject('REJECTED', 'AMOUNT_MISMATCH');
      return 'REJECTED_AMOUNT_MISMATCH';
    }
    if (account.status === 'CLOSED') {
      await reject('REJECTED', 'ACCOUNT_CLOSED');
      return 'REJECTED_ACCOUNT_CLOSED';
    }

    const applied = amount.min(Money.of(account.outstandingBalance, currency));
    const excess = amount.subtract(applied);

    const operatingCash = await this.ledger.ensureAccount(tx, 'OPERATING_CASH', null, currency);
    const postings: PostingInput[] = [{ accountId: operatingCash.id, direction: 'DEBIT', amount }];
    if (applied.isPositive()) {
      const receivable = await this.ledger.ensureAccount(
        tx,
        'CARD_RECEIVABLE',
        account.id,
        currency,
      );
      postings.push({ accountId: receivable.id, direction: 'CREDIT', amount: applied });
    }
    if (excess.isPositive()) {
      const refundPayable = await this.ledger.ensureAccount(
        tx,
        'REFUND_PAYABLE',
        account.id,
        currency,
      );
      postings.push({ accountId: refundPayable.id, direction: 'CREDIT', amount: excess });
    }
    const entry = await this.ledger.post(tx, {
      type: 'REPAYMENT_SETTLED',
      reference: `repayment:${repayment.id}:settled`,
      description: `Repayment ${repayment.providerReference}`,
      metadata: { repaymentId: repayment.id, creditAccountId: account.id },
      postings,
    });

    await tx
      .update(creditAccounts)
      .set({
        outstandingBalance: sql`${creditAccounts.outstandingBalance} - ${applied.minor.toString()}::bigint`,
      })
      .where(eq(creditAccounts.id, account.id));
    await tx
      .update(repayments)
      .set({
        status: 'SETTLED',
        appliedAmount: applied.minor,
        excessAmount: excess.minor,
        journalEntryId: entry.id,
        settledAt: new Date(),
      })
      .where(eq(repayments.id, repayment.id));
    await this.events.emit(tx, {
      type: 'RepaymentSettled',
      entityType: 'repayment',
      entityId: repayment.id,
      creditAccountId: account.id,
      data: {
        repaymentId: repayment.id,
        amount: amount.toJSON(),
        applied: applied.toJSON(),
        excess: excess.toJSON(),
        journalEntryId: entry.id,
      },
    });
    return 'SETTLED';
  }
}

export function present(repayment: Repayment) {
  const currency = repayment.currency as Currency;
  const money = (v: bigint | null) => (v === null ? null : Money.of(v, currency).toJSON());
  return {
    id: repayment.id,
    creditAccountId: repayment.creditAccountId,
    amount: Money.of(repayment.amount, currency).toJSON(),
    status: repayment.status,
    appliedAmount: money(repayment.appliedAmount),
    excessAmount: money(repayment.excessAmount),
    providerReference: repayment.providerReference,
    failureReason: repayment.failureReason,
    createdAt: repayment.createdAt,
    settledAt: repayment.settledAt,
  };
}
