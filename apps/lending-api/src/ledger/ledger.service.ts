import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Currency, Money } from '../common/money/money';
import type { Executor, Transaction } from '../database/database';
import { findPgError, PgErrorCode } from '../database/pg-errors';
import { journalEntries, LedgerAccount, ledgerAccounts, postings } from '../database/schema';
import { ACCOUNT_KINDS, AccountKind } from './account-kinds';
import { assertValidEntry, JournalEntryInput } from './journal-entry';
import {
  DuplicateJournalEntryError,
  InsufficientBalanceError,
  InvalidJournalEntryError,
  LedgerAccountNotFoundError,
} from './ledger.errors';

export interface PostedEntry {
  id: string;
  createdAt: Date;
}

export interface BalanceDrift {
  accountId: string;
  cached: string;
  recomputed: string;
}

/**
 * The only way money moves. Write methods take a `Transaction` (not the pool), so a
 * posting is always part of the caller's unit of work — together with the state change
 * that justifies it and its idempotency record.
 */
@Injectable()
export class LedgerService {
  /** Returns the account, creating it on first use. Safe under concurrency. */
  async ensureAccount(
    tx: Transaction,
    kind: AccountKind,
    ownerId: string | null = null,
    currency: Currency = 'USD',
  ): Promise<LedgerAccount> {
    const spec = ACCOUNT_KINDS[kind];
    if ((spec.scope === 'customer') !== (ownerId !== null)) {
      throw new InvalidJournalEntryError(
        `${kind} is a ${spec.scope} account and ${spec.scope === 'customer' ? 'needs' : 'cannot have'} an owner`,
      );
    }
    await tx
      .insert(ledgerAccounts)
      .values({
        kind,
        ownerId,
        currency,
        category: spec.category,
        allowNegative: spec.allowNegative,
      })
      .onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.kind, kind),
          ownerId === null ? isNull(ledgerAccounts.ownerId) : eq(ledgerAccounts.ownerId, ownerId),
          eq(ledgerAccounts.currency, currency),
        ),
      );
    return account!;
  }

  async post(tx: Transaction, entry: JournalEntryInput): Promise<PostedEntry> {
    assertValidEntry(entry);
    try {
      const [created] = await tx
        .insert(journalEntries)
        .values({
          entryType: entry.type,
          reference: entry.reference,
          description: entry.description,
          metadata: entry.metadata ?? {},
        })
        .returning({ id: journalEntries.id, createdAt: journalEntries.createdAt });
      // Postings lock their accounts as they apply. A fixed order (by account id) means two
      // entries touching the same accounts always lock them in the same order: no deadlocks.
      const ordered = [...entry.postings].sort((a, b) => a.accountId.localeCompare(b.accountId));
      await tx.insert(postings).values(
        ordered.map((p) => ({
          journalEntryId: created!.id,
          accountId: p.accountId,
          direction: p.direction,
          amount: p.amount.minor,
          currency: p.amount.currency,
        })),
      );
      return created!;
    } catch (error) {
      throw this.translate(error, entry);
    }
  }

  async getAccount(db: Executor, accountId: string): Promise<LedgerAccount> {
    const [account] = await db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId));
    if (!account) throw new LedgerAccountNotFoundError(`ledger account ${accountId} not found`);
    return account;
  }

  async balanceOf(db: Executor, accountId: string): Promise<Money> {
    const account = await this.getAccount(db, accountId);
    return Money.of(account.balance, account.currency as Currency);
  }

  /** Journal entries (newest first) with their postings, optionally for one owner's accounts. */
  async listEntries(db: Executor, filter: { ownerId?: string; limit: number }) {
    const entries = await db.execute<{
      id: string;
      entry_type: string;
      reference: string | null;
      description: string;
      created_at: string;
    }>(sql`
      SELECT je.id, je.entry_type, je.reference, je.description, je.created_at
        FROM journal_entries je
       WHERE ${filter.ownerId ?? null}::uuid IS NULL OR EXISTS (
               SELECT 1 FROM postings p JOIN ledger_accounts a ON a.id = p.account_id
                WHERE p.journal_entry_id = je.id AND a.owner_id = ${filter.ownerId ?? null}::uuid)
       ORDER BY je.created_at DESC, je.id
       LIMIT ${filter.limit}`);
    const ids = entries.rows.map((e) => e.id);
    if (ids.length === 0) return [];
    const legs = await db.execute<{
      journal_entry_id: string;
      account_id: string;
      kind: string;
      owner_id: string | null;
      direction: 'DEBIT' | 'CREDIT';
      amount: string;
      currency: string;
    }>(sql`
      SELECT p.journal_entry_id, p.account_id, a.kind, a.owner_id, p.direction, p.amount::text, p.currency
        FROM postings p JOIN ledger_accounts a ON a.id = p.account_id
       WHERE p.journal_entry_id IN (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
       ORDER BY p.id`);
    return entries.rows.map((e) => ({
      id: e.id,
      type: e.entry_type,
      reference: e.reference,
      description: e.description,
      createdAt: e.created_at,
      postings: legs.rows
        .filter((l) => l.journal_entry_id === e.id)
        .map((l) => ({
          accountId: l.account_id,
          accountKind: l.kind,
          ownerId: l.owner_id,
          direction: l.direction,
          amount: { amount: l.amount, currency: l.currency },
        })),
    }));
  }

  /** Sum of debit-normal balances must equal sum of credit-normal balances. */
  async trialBalance(db: Executor) {
    const result = await db.execute<{ debit_normal: string; credit_normal: string }>(sql`
      SELECT coalesce(sum(balance) FILTER (WHERE category IN ('ASSET', 'EXPENSE')), 0)::text AS debit_normal,
             coalesce(sum(balance) FILTER (WHERE category NOT IN ('ASSET', 'EXPENSE')), 0)::text AS credit_normal
        FROM ledger_accounts`);
    const row = result.rows[0]!;
    return {
      debitNormal: BigInt(row.debit_normal),
      creditNormal: BigInt(row.credit_normal),
      balanced: row.debit_normal === row.credit_normal,
    };
  }

  /** Accounts whose cached balance disagrees with the sum of their postings. Should always be empty. */
  async findBalanceDrift(db: Executor): Promise<BalanceDrift[]> {
    const result = await db.execute<{ account_id: string; cached: string; recomputed: string }>(sql`
      SELECT a.id AS account_id, a.balance::text AS cached, r.recomputed::text AS recomputed
        FROM ledger_accounts a
        CROSS JOIN LATERAL (
          SELECT coalesce(sum(CASE WHEN (a.category IN ('ASSET', 'EXPENSE')) = (p.direction = 'DEBIT')
                                   THEN p.amount ELSE -p.amount END), 0) AS recomputed
            FROM postings p WHERE p.account_id = a.id
        ) r
       WHERE a.balance <> r.recomputed`);
    return result.rows.map((r) => ({
      accountId: r.account_id,
      cached: r.cached,
      recomputed: r.recomputed,
    }));
  }

  private translate(error: unknown, entry: JournalEntryInput): unknown {
    const pg = findPgError(error);
    if (!pg) return error;
    if (
      pg.code === PgErrorCode.CheckViolation &&
      pg.constraint === 'ledger_accounts_balance_non_negative'
    ) {
      return new InsufficientBalanceError('posting would take a non-negative account below zero', {
        entryType: entry.type,
      });
    }
    if (
      pg.code === PgErrorCode.UniqueViolation &&
      pg.constraint === 'journal_entries_reference_unique'
    ) {
      return new DuplicateJournalEntryError(
        `journal entry "${entry.reference}" was already posted`,
        {
          reference: entry.reference,
        },
      );
    }
    if (
      pg.code === PgErrorCode.LedgerCurrencyMismatch ||
      pg.code === PgErrorCode.ForeignKeyViolation
    ) {
      return new InvalidJournalEntryError(pg.message);
    }
    return error;
  }
}
