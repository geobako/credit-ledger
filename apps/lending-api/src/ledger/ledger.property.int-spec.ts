import fc from 'fast-check';
import { LedgerAccount } from '../database/schema';
import { connectTestDatabase, TestDatabase } from '../test/database';
import { createCustomerAccounts, usd } from '../test/ledger-fixtures';
import { isDebitNormal } from './account-kinds';
import { PostingInput } from './journal-entry';
import { InsufficientBalanceError, InvalidJournalEntryError } from './ledger.errors';
import { LedgerService } from './ledger.service';

/**
 * Model-based property test: random sequences of entries (balanced, unbalanced, overdrawing)
 * against the real database must match a simple in-memory model, and the ledger-wide
 * invariants must hold after every run.
 */
describe('ledger invariants (property-based)', () => {
  let t: TestDatabase;
  const ledger = new LedgerService();

  beforeAll(() => {
    t = connectTestDatabase();
  });
  afterAll(() => t.close());

  // Leg = (account index, amount). Each entry debits some legs and credits others.
  const leg = fc.record({
    account: fc.nat({ max: 4 }),
    amount: fc.bigInt({ min: 1n, max: 5_000n }),
  });
  const entryArb = fc.record({
    debits: fc.array(leg, { minLength: 1, maxLength: 2 }),
    creditAccounts: fc.array(fc.nat({ max: 4 }), { minLength: 1, maxLength: 2 }),
    skew: fc.oneof(
      { weight: 9, arbitrary: fc.constant(0n) },
      { weight: 1, arbitrary: fc.bigInt({ min: 1n, max: 3n }) },
    ),
  });

  it('cached balances always equal the model and the books always balance', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entryArb, { minLength: 1, maxLength: 12 }), async (entries) => {
        const a = await createCustomerAccounts(t, ledger);
        // 0-3 are this run's customer accounts; 4 is the shared, overdraft-allowed operating cash.
        const accounts: LedgerAccount[] = [
          a.collateralHeld,
          a.receivable,
          a.collateralHeld,
          a.receivable,
          a.operatingCash,
        ];
        const model = new Map<string, bigint>([
          [a.collateralHeld.id, 0n],
          [a.receivable.id, 0n],
        ]);

        for (const e of entries) {
          const total = e.debits.reduce((sum, d) => sum + d.amount, 0n);
          const postings: PostingInput[] = e.debits.map((d) => ({
            accountId: accounts[d.account]!.id,
            direction: 'DEBIT',
            amount: usd(d.amount),
          }));
          // Split the credits so they sum to the debits (plus an occasional skew → unbalanced).
          const share = total / BigInt(e.creditAccounts.length);
          e.creditAccounts.forEach((idx, i) => {
            const isLast = i === e.creditAccounts.length - 1;
            const amount = isLast ? total - share * BigInt(i) + e.skew : share;
            if (amount > 0n)
              postings.push({
                accountId: accounts[idx]!.id,
                direction: 'CREDIT',
                amount: usd(amount),
              });
          });

          const next = new Map(model);
          for (const p of postings) {
            const acc = accounts.find((x) => x.id === p.accountId)!;
            if (!next.has(acc.id)) continue; // shared system account: not modelled
            const sign = isDebitNormal(acc.category) === (p.direction === 'DEBIT') ? 1n : -1n;
            next.set(acc.id, next.get(acc.id)! + sign * p.amount.minor);
          }
          const debited = new Set(
            postings.filter((p) => p.direction === 'DEBIT').map((p) => p.accountId),
          );
          const selfTransfer = postings.some(
            (p) => p.direction === 'CREDIT' && debited.has(p.accountId),
          );
          const balanced =
            e.skew === 0n && !selfTransfer && postings.some((p) => p.direction === 'CREDIT');
          const overdrawn = [...next.values()].some((v) => v < 0n);

          const outcome = await t.tx
            .run((tx) => ledger.post(tx, { type: 'PROPERTY', description: 'generated', postings }))
            .then(() => 'posted' as const)
            .catch((error: unknown) => {
              if (error instanceof InvalidJournalEntryError) return 'invalid' as const;
              if (error instanceof InsufficientBalanceError) return 'insufficient' as const;
              throw error;
            });

          const expected = !balanced ? 'invalid' : overdrawn ? 'insufficient' : 'posted';
          expect(outcome).toBe(expected);
          if (outcome === 'posted') next.forEach((v, k) => model.set(k, v));
        }

        for (const [accountId, expected] of model) {
          expect((await ledger.balanceOf(t.db, accountId)).minor).toBe(expected);
        }
      }),
      { numRuns: 30 },
    );

    expect((await ledger.trialBalance(t.db)).balanced).toBe(true);
    expect(await ledger.findBalanceDrift(t.db)).toEqual([]);
  });
});
