import { Currency, Money } from '../common/money/money';
import type { Card, CreditAccount } from '../database/schema';
import { availableCredit } from '../credit-accounts/credit-accounts.service';

export const DECLINE_REASONS = [
  'CARD_NOT_FOUND',
  'CARD_INACTIVE',
  'CARD_FROZEN',
  'CARD_CLOSED',
  'CARD_EXPIRED',
  'ACCOUNT_NOT_ACTIVE',
  'CURRENCY_NOT_SUPPORTED',
  'INSUFFICIENT_CREDIT',
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number];

/**
 * Pure authorization decision. Must be called with the credit account row locked, so the
 * available credit it sees cannot change before the hold is written.
 */
export function declineReason(
  account: CreditAccount,
  card: Card,
  amount: Money,
  now: Date,
): DeclineReason | null {
  if (card.status === 'INACTIVE') return 'CARD_INACTIVE';
  if (card.status === 'FROZEN') return 'CARD_FROZEN';
  if (card.status === 'CLOSED') return 'CARD_CLOSED';
  if (isExpired(card, now)) return 'CARD_EXPIRED';
  if (account.status !== 'ACTIVE') return 'ACCOUNT_NOT_ACTIVE';
  if (amount.currency !== (account.currency as Currency)) return 'CURRENCY_NOT_SUPPORTED';
  if (amount.gt(availableCredit(account))) return 'INSUFFICIENT_CREDIT';
  return null;
}

/** A card is valid through the last day of its expiry month (UTC). */
export function isExpired(card: Pick<Card, 'expiryMonth' | 'expiryYear'>, now: Date): boolean {
  const firstInvalidDay = Date.UTC(card.expiryYear, card.expiryMonth, 1);
  return now.getTime() >= firstInvalidDay;
}
