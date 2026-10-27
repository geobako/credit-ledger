import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { journalEntries, ledgerAccounts, postings } from '../database/schema';
import { findPgError } from '../database/pg-errors';
import { connectTestDatabase, TestDatabase } from '../test/database';
import { createCustomerAccounts, depositCollateral, usd } from '../test/ledger-fixtures';
import { transfer } from './journal-entry';
import {
  DuplicateJournalEntryError,
  InsufficientBalanceError,
  InvalidJournalEntryError,
} from './ledger.errors';
import { LedgerService } from './ledger.service';

describe('LedgerService (Postgres)', () => {
  let t: TestDatabase;
  const ledger = new LedgerService();

  beforeAll(() => {
    t = connectTestDatabase();
  });
  afterAll(() => t.close());

  const pgCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return findPgError(error)?.code;
    }
    throw new Error('expected the database to reject the operation');
  };

  it('posts a balanced entry and moves cached balances in each normal direction', async () => {
    const a = await createCustomerAccounts(t, ledger);
    await t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(50_000)));

    expect((await ledger.balanceOf(t.db, a.collateralHeld.id)).minor).toBe(50_000n);

    await t.tx.run((tx) =>
      ledger.post(tx, {
        type: 'PURCHASE_CAPTURED',
        description: 'coffee',
        postings: transfer(a.receivable.id, a.merchantPayable.id, usd(450)),
      }),
    );
    expect((await ledger.balanceOf(t.db, a.receivable.id)).minor).toBe(450n);
  });

  it('refuses to take a non-negative account below zero and rolls back everything', async () => {
    const a = await createCustomerAccounts(t, ledger);
    await t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(1_000)));

    await expect(
      t.tx.run((tx) =>
        ledger.post(tx, {
          type: 'COLLATERAL_RELEASED',
          description: 'release more than held',
          postings: transfer(a.collateralHeld.id, a.collateralCash.id, usd(1_001)),
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);

    expect((await ledger.balanceOf(t.db, a.collateralHeld.id)).minor).toBe(1_000n);
  });

  it('serialises concurrent debits on one account: never overdrawn, exactly the affordable ones win', async () => {
    const a = await createCustomerAccounts(t, ledger);
    await t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(1_000)));

    const attempts = Array.from({ length: 50 }, () =>
      t.tx.run((tx) =>
        ledger.post(tx, {
          type: 'COLLATERAL_RELEASED',
          description: 'concurrent partial release',
          postings: transfer(a.collateralHeld.id, a.collateralCash.id, usd(30)),
        }),
      ),
    );
    const results = await Promise.allSettled(attempts);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const insufficient = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof InsufficientBalanceError,
    ).length;

    expect(succeeded).toBe(33); // floor(1000 / 30)
    expect(insufficient).toBe(17);
    expect((await ledger.balanceOf(t.db, a.collateralHeld.id)).minor).toBe(10n);
  });

  it('rejects a reused entry reference', async () => {
    const a = await createCustomerAccounts(t, ledger);
    const reference = `deposit:${randomUUID()}:confirmed`;
    await t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(100), reference));

    await expect(
      t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(100), reference)),
    ).rejects.toBeInstanceOf(DuplicateJournalEntryError);
    expect((await ledger.balanceOf(t.db, a.collateralHeld.id)).minor).toBe(100n);
  });

  it('rejects postings to unknown accounts', async () => {
    const a = await createCustomerAccounts(t, ledger);
    await expect(
      t.tx.run((tx) =>
        ledger.post(tx, {
          type: 'TEST',
          description: 'unknown account',
          postings: transfer(a.collateralCash.id, randomUUID(), usd(1)),
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });

  it('creates each account once, even under concurrent first use', async () => {
    const ownerId = randomUUID();
    const ids = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.tx.run((tx) => ledger.ensureAccount(tx, 'COLLATERAL_HELD', ownerId)),
      ),
    );
    expect(new Set(ids.map((acc) => acc.id)).size).toBe(1);
  });

  describe('database-level guarantees (bypassing the service)', () => {
    it('rejects an unbalanced entry at commit (LG001)', async () => {
      const a = await createCustomerAccounts(t, ledger);
      const code = await pgCode(
        t.db.transaction(async (tx) => {
          const [entry] = await tx
            .insert(journalEntries)
            .values({ entryType: 'HACK', description: 'one-legged' })
            .returning();
          await tx.insert(postings).values({
            journalEntryId: entry!.id,
            accountId: a.collateralHeld.id,
            direction: 'CREDIT',
            amount: 1_000_000n,
            currency: 'USD',
          });
        }),
      );
      expect(code).toBe('LG001');
      expect((await ledger.balanceOf(t.db, a.collateralHeld.id)).minor).toBe(0n);
    });

    it('rejects an entry with no postings at commit (LG001)', async () => {
      const code = await pgCode(
        t.db.insert(journalEntries).values({ entryType: 'HACK', description: 'empty' }),
      );
      expect(code).toBe('LG001');
    });

    it('rejects adding postings to an entry from an earlier transaction (LG004)', async () => {
      const a = await createCustomerAccounts(t, ledger);
      const entry = await t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(100)));
      const code = await pgCode(
        t.db.transaction(async (tx) => {
          await tx.insert(postings).values([
            {
              journalEntryId: entry.id,
              accountId: a.collateralCash.id,
              direction: 'DEBIT',
              amount: 5n,
              currency: 'USD',
            },
            {
              journalEntryId: entry.id,
              accountId: a.collateralHeld.id,
              direction: 'CREDIT',
              amount: 5n,
              currency: 'USD',
            },
          ]);
        }),
      );
      expect(code).toBe('LG004');
    });

    it('makes journal entries and postings append-only (LG002)', async () => {
      const a = await createCustomerAccounts(t, ledger);
      const entry = await t.tx.run((tx) => depositCollateral(tx, ledger, a, usd(100)));

      expect(
        await pgCode(
          t.db.update(postings).set({ amount: 1n }).where(eq(postings.journalEntryId, entry.id)),
        ),
      ).toBe('LG002');
      expect(await pgCode(t.db.delete(postings).where(eq(postings.journalEntryId, entry.id)))).toBe(
        'LG002',
      );
      expect(
        await pgCode(
          t.db
            .update(journalEntries)
            .set({ description: 'edited' })
            .where(eq(journalEntries.id, entry.id)),
        ),
      ).toBe('LG002');
      expect(await pgCode(t.db.delete(journalEntries).where(eq(journalEntries.id, entry.id)))).toBe(
        'LG002',
      );
      expect(await pgCode(t.db.execute(sql`TRUNCATE postings`))).toBe('LG002');
    });

    it('forbids editing a balance directly (LG002)', async () => {
      const a = await createCustomerAccounts(t, ledger);
      const code = await pgCode(
        t.db
          .update(ledgerAccounts)
          .set({ balance: 1_000_000n })
          .where(eq(ledgerAccounts.id, a.collateralHeld.id)),
      );
      expect(code).toBe('LG002');
    });

    it('rejects a posting whose currency differs from its account (LG003)', async () => {
      const a = await createCustomerAccounts(t, ledger);
      const code = await pgCode(
        t.db.transaction(async (tx) => {
          const [entry] = await tx
            .insert(journalEntries)
            .values({ entryType: 'HACK', description: 'currency' })
            .returning();
          await tx.insert(postings).values([
            {
              journalEntryId: entry!.id,
              accountId: a.collateralCash.id,
              direction: 'DEBIT',
              amount: 5n,
              currency: 'EUR',
            },
            {
              journalEntryId: entry!.id,
              accountId: a.collateralHeld.id,
              direction: 'CREDIT',
              amount: 5n,
              currency: 'EUR',
            },
          ]);
        }),
      );
      expect(code).toBe('LG003');
    });
  });
});
