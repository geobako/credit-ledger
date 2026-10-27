import { Money } from '../common/money/money';
import { assertValidEntry, JournalEntryInput, transfer } from './journal-entry';
import { InvalidJournalEntryError } from './ledger.errors';

const usd = (minor: bigint) => Money.of(minor);
const entry = (postings: JournalEntryInput['postings']): JournalEntryInput => ({
  type: 'TEST',
  description: 'test',
  postings,
});

describe('assertValidEntry', () => {
  it('accepts a balanced two-legged entry', () => {
    expect(() => assertValidEntry(entry(transfer('a', 'b', usd(100n))))).not.toThrow();
  });

  it('accepts a balanced multi-legged entry', () => {
    expect(() =>
      assertValidEntry(
        entry([
          { accountId: 'a', direction: 'DEBIT', amount: usd(70n) },
          { accountId: 'b', direction: 'DEBIT', amount: usd(30n) },
          { accountId: 'c', direction: 'CREDIT', amount: usd(100n) },
        ]),
      ),
    ).not.toThrow();
  });

  it.each([
    ['single posting', [{ accountId: 'a', direction: 'DEBIT' as const, amount: usd(1n) }]],
    [
      'unbalanced',
      [
        { accountId: 'a', direction: 'DEBIT' as const, amount: usd(100n) },
        { accountId: 'b', direction: 'CREDIT' as const, amount: usd(99n) },
      ],
    ],
    ['zero amount', transfer('a', 'b', usd(0n))],
    ['self transfer', transfer('a', 'a', usd(10n))],
    ['negative amount', transfer('a', 'b', usd(-5n))],
  ])('rejects %s', (_label, postings) => {
    expect(() => assertValidEntry(entry(postings))).toThrow(InvalidJournalEntryError);
  });

  it('rejects a blank description', () => {
    expect(() =>
      assertValidEntry({ ...entry(transfer('a', 'b', usd(1n))), description: ' ' }),
    ).toThrow(InvalidJournalEntryError);
  });
});
