import { Money } from '../common/money/money';

export interface ClosureBalances {
  /** What the customer owes (card receivable). */
  debt: Money;
  /** Overpayments we owe the customer. */
  refundDue: Money;
  /** Confirmed collateral we hold for the customer. */
  collateral: Money;
}

export interface ClosurePlan {
  refundApplied: Money;
  collateralApplied: Money;
  writtenOff: Money;
  collateralReleased: Money;
  refundReleased: Money;
  /** Paid back to the customer: released collateral + released refund. */
  payout: Money;
}

/**
 * How an account's books are settled at closure. Debt is covered, in order, by money we
 * already owe the customer (overpayments), then by their collateral; anything still unpaid is
 * written off. Whatever is left of both is returned to the customer.
 *
 * Conservation laws (property-tested): every cent of debt is covered or written off, every
 * cent we hold for the customer is either applied or paid out.
 */
export function planClosure({ debt, refundDue, collateral }: ClosureBalances): ClosurePlan {
  const refundApplied = refundDue.min(debt);
  let remaining = debt.subtract(refundApplied);
  const collateralApplied = collateral.min(remaining);
  remaining = remaining.subtract(collateralApplied);

  const collateralReleased = collateral.subtract(collateralApplied);
  const refundReleased = refundDue.subtract(refundApplied);
  return {
    refundApplied,
    collateralApplied,
    writtenOff: remaining,
    collateralReleased,
    refundReleased,
    payout: collateralReleased.add(refundReleased),
  };
}
