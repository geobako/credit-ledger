import { Money } from '../common/money/money';
import type { Card, CreditAccount } from '../database/schema';
import { declineReason, isExpired } from './decline';

const now = new Date('2026-10-27T12:00:00Z');
const account = (over: Partial<CreditAccount> = {}) =>
  ({
    status: 'ACTIVE',
    currency: 'USD',
    creditLimit: 10_000n,
    outstandingBalance: 3_000n,
    heldAmount: 2_000n,
    ...over,
  }) as CreditAccount;
const card = (over: Partial<Card> = {}) =>
  ({ status: 'ACTIVE', expiryMonth: 10, expiryYear: 2030, ...over }) as Card;
const usd = (minor: bigint) => Money.of(minor);

describe('declineReason', () => {
  it('approves up to exactly the available credit', () => {
    expect(declineReason(account(), card(), usd(5_000n), now)).toBeNull();
  });

  it('declines one cent over the available credit', () => {
    expect(declineReason(account(), card(), usd(5_001n), now)).toBe('INSUFFICIENT_CREDIT');
  });

  it.each([
    ['INACTIVE', 'CARD_INACTIVE'],
    ['FROZEN', 'CARD_FROZEN'],
    ['CLOSED', 'CARD_CLOSED'],
  ] as const)('declines a %s card', (status, reason) => {
    expect(declineReason(account(), card({ status }), usd(1n), now)).toBe(reason);
  });

  it('declines when the account is not active', () => {
    expect(declineReason(account({ status: 'PENDING_COLLATERAL' }), card(), usd(1n), now)).toBe(
      'ACCOUNT_NOT_ACTIVE',
    );
  });

  it('checks card status before credit, so a frozen card never leaks available credit', () => {
    expect(declineReason(account(), card({ status: 'FROZEN' }), usd(999_999n), now)).toBe(
      'CARD_FROZEN',
    );
  });
});

describe('isExpired', () => {
  it('is valid through the last day of the expiry month', () => {
    expect(isExpired({ expiryMonth: 10, expiryYear: 2026 }, new Date('2026-10-31T23:59:59Z'))).toBe(
      false,
    );
    expect(isExpired({ expiryMonth: 10, expiryYear: 2026 }, new Date('2026-11-01T00:00:00Z'))).toBe(
      true,
    );
    expect(isExpired({ expiryMonth: 12, expiryYear: 2026 }, new Date('2027-01-01T00:00:00Z'))).toBe(
      true,
    );
  });
});
