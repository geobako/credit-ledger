import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isOps, Principal } from '../auth/principal';
import { ForbiddenError, NotFoundError } from '../common/errors/domain-error';
import { Currency, Money } from '../common/money/money';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import {
  AccountClosure,
  accountClosures,
  authorizations,
  cards,
  creditAccounts,
} from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { IdempotencyService, IdempotentRequest } from '../idempotency/idempotency.service';
import { PostingInput, transfer } from '../ledger/journal-entry';
import { LedgerService } from '../ledger/ledger.service';
import {
  InsufficientCollateralToCloseError,
  LedgerNotSettledError,
  OpenAuthorizationsError,
} from './closure.errors';
import { planClosure } from './settlement-plan';

export type ClosureReason = AccountClosure['reason'];

/**
 * Closes a credit account and settles its books in one transaction:
 *   good standing → collateral (and any overpayment) is returned in full;
 *   debt          → overpayments, then collateral, are applied to it and the rest returned;
 *   charge-off    → (operations only) whatever collateral cannot cover is written off.
 * A customer can never use closure to walk away from debt their collateral doesn't cover.
 */
@Injectable()
export class ClosureService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tx: TransactionManager,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: CreditAccountsService,
  ) {}

  close(principal: Principal, accountId: string, reason: ClosureReason, idem: IdempotentRequest) {
    if (reason === 'CHARGE_OFF' && !isOps(principal)) {
      throw new ForbiddenError('only operations can charge off an account');
    }
    return this.tx.run((tx) =>
      this.idempotency.execute(tx, idem, async () => {
        const visible = await this.accounts.findAccessible(tx, principal, accountId);
        const account = await this.accounts.lock(tx, visible.id);
        if (account.status === 'CLOSED') {
          return { status: 200, body: present(await this.findClosure(tx, account.id)) };
        }

        const [openHold] = await tx
          .select({ id: authorizations.id })
          .from(authorizations)
          .where(
            and(eq(authorizations.creditAccountId, account.id), eq(authorizations.status, 'HELD')),
          )
          .limit(1);
        if (openHold || account.heldAmount > 0n) {
          throw new OpenAuthorizationsError(
            'the account has pending card authorizations; it can be closed once they settle or expire',
          );
        }

        const currency = account.currency as Currency;
        const receivable = await this.ledger.ensureAccount(
          tx,
          'CARD_RECEIVABLE',
          account.id,
          currency,
        );
        const refundPayable = await this.ledger.ensureAccount(
          tx,
          'REFUND_PAYABLE',
          account.id,
          currency,
        );
        const collateralHeld = await this.ledger.ensureAccount(
          tx,
          'COLLATERAL_HELD',
          account.id,
          currency,
        );
        const plan = planClosure({
          debt: await this.ledger.balanceOf(tx, receivable.id),
          refundDue: await this.ledger.balanceOf(tx, refundPayable.id),
          collateral: await this.ledger.balanceOf(tx, collateralHeld.id),
        });
        if (plan.writtenOff.isPositive() && reason === 'CUSTOMER_REQUEST') {
          throw new InsufficientCollateralToCloseError(
            `your collateral does not cover your balance; repay at least ${plan.writtenOff.toString()} first`,
            { shortfall: plan.writtenOff.toJSON() },
          );
        }

        const collateralCash = await this.ledger.ensureAccount(
          tx,
          'COLLATERAL_CASH',
          null,
          currency,
        );
        const operatingCash = await this.ledger.ensureAccount(tx, 'OPERATING_CASH', null, currency);
        const post = async (
          component: string,
          description: string,
          amount: Money,
          postings: PostingInput[],
        ) => {
          if (amount.isZero()) return;
          await this.ledger.post(tx, {
            type: `CLOSURE_${component}`,
            reference: `closure:${account.id}:${component.toLowerCase()}`,
            description,
            metadata: { creditAccountId: account.id, reason },
            postings,
          });
        };

        await post(
          'REFUND_APPLIED',
          'Overpayment applied to balance',
          plan.refundApplied,
          transfer(refundPayable.id, receivable.id, plan.refundApplied),
        );
        await post('COLLATERAL_APPLIED', 'Collateral applied to balance', plan.collateralApplied, [
          ...transfer(collateralHeld.id, receivable.id, plan.collateralApplied),
          // The segregated cash backing that collateral now belongs to the company.
          ...transfer(operatingCash.id, collateralCash.id, plan.collateralApplied),
        ]);
        if (plan.writtenOff.isPositive()) {
          const creditLoss = await this.ledger.ensureAccount(tx, 'CREDIT_LOSS', null, currency);
          await post(
            'WRITTEN_OFF',
            'Unrecoverable balance written off',
            plan.writtenOff,
            transfer(creditLoss.id, receivable.id, plan.writtenOff),
          );
        }
        await post(
          'COLLATERAL_RELEASED',
          'Collateral returned to customer',
          plan.collateralReleased,
          transfer(collateralHeld.id, collateralCash.id, plan.collateralReleased),
        );
        await post(
          'REFUND_RELEASED',
          'Overpayment returned to customer',
          plan.refundReleased,
          transfer(refundPayable.id, operatingCash.id, plan.refundReleased),
        );

        // Defensive: after closure the customer's books must be exactly zero.
        for (const ledgerAccount of [receivable, refundPayable, collateralHeld]) {
          const balance = await this.ledger.balanceOf(tx, ledgerAccount.id);
          if (!balance.isZero()) {
            throw new LedgerNotSettledError(
              `ledger account ${ledgerAccount.kind} not settled at closure`,
            );
          }
        }

        const now = new Date();
        await tx
          .update(creditAccounts)
          .set({ status: 'CLOSED', closedAt: now, creditLimit: 0n, outstandingBalance: 0n })
          .where(eq(creditAccounts.id, account.id));
        await tx
          .update(cards)
          .set({ status: 'CLOSED' })
          .where(eq(cards.creditAccountId, account.id));
        const [closure] = await tx
          .insert(accountClosures)
          .values({
            creditAccountId: account.id,
            reason,
            initiatedBy: principal.userId,
            debtAtClosure: plan.refundApplied.add(plan.collateralApplied).add(plan.writtenOff)
              .minor,
            refundApplied: plan.refundApplied.minor,
            collateralApplied: plan.collateralApplied.minor,
            writtenOff: plan.writtenOff.minor,
            payoutAmount: plan.payout.minor,
            currency,
          })
          .returning();
        return { status: 200, body: present(closure!) };
      }),
    );
  }

  async get(principal: Principal, accountId: string) {
    const account = await this.accounts.findAccessible(this.db, principal, accountId);
    return present(await this.findClosure(this.db, account.id));
  }

  private async findClosure(
    db: Database | Transaction,
    accountId: string,
  ): Promise<AccountClosure> {
    const [closure] = await db
      .select()
      .from(accountClosures)
      .where(eq(accountClosures.creditAccountId, accountId));
    if (!closure) throw new NotFoundError('this account has not been closed');
    return closure;
  }
}

export function present(closure: AccountClosure) {
  const currency = closure.currency as Currency;
  const money = (v: bigint) => Money.of(v, currency).toJSON();
  return {
    creditAccountId: closure.creditAccountId,
    reason: closure.reason,
    debtAtClosure: money(closure.debtAtClosure),
    refundApplied: money(closure.refundApplied),
    collateralApplied: money(closure.collateralApplied),
    writtenOff: money(closure.writtenOff),
    payout: money(closure.payoutAmount),
    closedAt: closure.createdAt,
  };
}
