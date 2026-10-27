import { minor } from '@/lib/money';
import type { CreditAccount } from '@/lib/types';

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Preview of how closing settles the books, mirroring the server's planClosure: debt is
 * covered by overpayments first, then collateral; the rest is returned. Display only: the
 * server recomputes everything under lock when the request arrives.
 */
export function previewClosure(account: CreditAccount) {
  const debt = minor(account.outstandingBalance);
  const refund = minor(account.refundDue);
  const collateral = minor(account.collateral);
  const refundApplied = min(refund, debt);
  const collateralApplied = min(collateral, debt - refundApplied);
  const shortfall = debt - refundApplied - collateralApplied;
  return {
    debt,
    refundApplied,
    collateralApplied,
    shortfall,
    payout: collateral - collateralApplied + (refund - refundApplied),
  };
}
