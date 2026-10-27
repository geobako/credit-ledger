import { Money } from '../common/money/money';
import { InvalidJournalEntryError } from './ledger.errors';

export type Direction = 'DEBIT' | 'CREDIT';

export interface PostingInput {
  accountId: string;
  direction: Direction;
  amount: Money;
}

export interface JournalEntryInput {
  /** Business event, e.g. `COLLATERAL_CONFIRMED`. */
  type: string;
  /** Unique natural key, e.g. `deposit:<id>:confirmed`. Posting it twice fails. */
  reference?: string;
  description: string;
  metadata?: Record<string, unknown>;
  postings: PostingInput[];
}

/**
 * Application-side validation. The database enforces the same rules (trigger
 * `journal_entries_balanced`); checking here gives clear errors before a round trip.
 */
export function assertValidEntry(entry: JournalEntryInput): void {
  const { postings } = entry;
  if (!entry.type.trim() || !entry.description.trim()) {
    throw new InvalidJournalEntryError('entry type and description are required');
  }
  if (postings.length < 2) {
    throw new InvalidJournalEntryError('a journal entry needs at least two postings');
  }
  const currency = postings[0]!.amount.currency;
  const sides = new Map<string, Direction>();
  let debits = 0n;
  let credits = 0n;
  for (const posting of postings) {
    if (!posting.amount.isPositive()) {
      throw new InvalidJournalEntryError('posting amounts must be positive', {
        accountId: posting.accountId,
        amount: posting.amount.toJSON(),
      });
    }
    if (posting.amount.currency !== currency) {
      throw new InvalidJournalEntryError('all postings in an entry must share one currency');
    }
    // Debiting and crediting one account in the same entry is meaningless, and the
    // non-negative check runs per posting, so it could fail on an intermediate state.
    if ((sides.get(posting.accountId) ?? posting.direction) !== posting.direction) {
      throw new InvalidJournalEntryError(
        'an account cannot be both debited and credited in one entry',
        {
          accountId: posting.accountId,
        },
      );
    }
    sides.set(posting.accountId, posting.direction);
    if (posting.direction === 'DEBIT') debits += posting.amount.minor;
    else credits += posting.amount.minor;
  }
  if (debits !== credits) {
    throw new InvalidJournalEntryError('debits must equal credits', {
      debits: debits.toString(),
      credits: credits.toString(),
    });
  }
}

/** Convenience for the common two-legged entry: debit one account, credit another. */
export function transfer(debit: string, credit: string, amount: Money): PostingInput[] {
  return [
    { accountId: debit, direction: 'DEBIT', amount },
    { accountId: credit, direction: 'CREDIT', amount },
  ];
}
