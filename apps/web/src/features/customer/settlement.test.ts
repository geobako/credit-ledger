import { describe, expect, it } from 'vitest';
import type { CreditAccount } from '@/lib/types';
import { previewClosure } from './settlement';

const usd = (amount: bigint) => ({ amount: amount.toString(), currency: 'USD' });
const account = (collateral: bigint, debt: bigint, refund = 0n) =>
  ({
    collateral: usd(collateral),
    outstandingBalance: usd(debt),
    refundDue: usd(refund),
  }) as CreditAccount;

describe('previewClosure', () => {
  it('returns all collateral in good standing', () => {
    expect(previewClosure(account(50_000n, 0n))).toMatchObject({
      payout: 50_000n,
      collateralApplied: 0n,
    });
  });

  it('applies collateral to debt and returns the rest', () => {
    expect(previewClosure(account(50_000n, 12_000n))).toMatchObject({
      collateralApplied: 12_000n,
      payout: 38_000n,
      shortfall: 0n,
    });
  });

  it('uses overpayments before collateral', () => {
    expect(previewClosure(account(50_000n, 1_000n, 3_000n))).toMatchObject({
      refundApplied: 1_000n,
      collateralApplied: 0n,
      payout: 52_000n,
    });
  });
});
