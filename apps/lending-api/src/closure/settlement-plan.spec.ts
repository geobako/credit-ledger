import fc from 'fast-check';
import { Money } from '../common/money/money';
import { planClosure } from './settlement-plan';

const usd = (minor: bigint) => Money.of(minor);
const plan = (debt: bigint, refundDue: bigint, collateral: bigint) =>
  planClosure({ debt: usd(debt), refundDue: usd(refundDue), collateral: usd(collateral) });
const amounts = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.minor]));

describe('planClosure', () => {
  it('returns everything when there is no debt (good standing)', () => {
    expect(amounts(plan(0n, 300n, 50_000n))).toEqual({
      refundApplied: 0n,
      collateralApplied: 0n,
      writtenOff: 0n,
      collateralReleased: 50_000n,
      refundReleased: 300n,
      payout: 50_300n,
    });
  });

  it('uses overpayments before collateral, and releases the rest', () => {
    expect(amounts(plan(1_000n, 300n, 50_000n))).toMatchObject({
      refundApplied: 300n,
      collateralApplied: 700n,
      writtenOff: 0n,
      collateralReleased: 49_300n,
      payout: 49_300n,
    });
  });

  it('writes off only what collateral cannot cover', () => {
    expect(amounts(plan(60_000n, 0n, 50_000n))).toMatchObject({
      collateralApplied: 50_000n,
      writtenOff: 10_000n,
      collateralReleased: 0n,
      payout: 0n,
    });
  });

  it('conserves every cent', () => {
    const cents = fc.bigInt({ min: 0n, max: 10n ** 12n });
    fc.assert(
      fc.property(cents, cents, cents, (debt, refundDue, collateral) => {
        const p = plan(debt, refundDue, collateral);
        const nonNegative = (Object.values(p) as Money[]).every((m) => !m.isNegative());
        const debtSettled =
          p.refundApplied.add(p.collateralApplied).add(p.writtenOff).minor === debt;
        const heldAccounted =
          p.refundApplied.add(p.refundReleased).minor === refundDue &&
          p.collateralApplied.add(p.collateralReleased).minor === collateral;
        const noNeedlessWriteOff = p.writtenOff.isZero() || p.payout.isZero();
        return nonNegative && debtSettled && heldAccounted && noNeedlessWriteOff;
      }),
    );
  });
});
