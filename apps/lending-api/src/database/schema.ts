import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database schema. drizzle-kit generates the table DDL in db/migrations from this file;
 * invariants that cannot be expressed here (ledger triggers) live in hand-written
 * custom migrations alongside them.
 *
 * Money columns are BIGINT minor units, read as JS bigint — never a float.
 */

const xid8 = customType<{ data: string; driverData: string }>({ dataType: () => 'xid8' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ── Ledger ──────────────────────────────────────────────────────────────────

export const accountCategory = pgEnum('account_category', [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
]);

export const entryDirection = pgEnum('entry_direction', ['DEBIT', 'CREDIT']);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    ownerId: uuid('owner_id'),
    category: accountCategory('category').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** Balance in the account's normal direction: positive means "holds value" for every category. */
    balance: bigint('balance', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    allowNegative: boolean('allow_negative').notNull().default(false),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [
    unique('ledger_accounts_kind_owner_currency_key')
      .on(t.kind, t.ownerId, t.currency)
      .nullsNotDistinct(),
    check('ledger_accounts_balance_non_negative', sql`${t.allowNegative} OR ${t.balance} >= 0`),
    check('ledger_accounts_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryType: text('entry_type').notNull(),
    /** Natural business key (e.g. `deposit:<id>:confirmed`): second line of defence against double posting. */
    reference: text('reference').unique(),
    description: text('description').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** Transaction that created the entry; postings may only be added within it. */
    createdXid: xid8('created_xid')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    createdAt: createdAt(),
  },
  (t) => [index('journal_entries_created_at_idx').on(t.createdAt)],
);

export const postings = pgTable(
  'postings',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: entryDirection('direction').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('postings_amount_positive', sql`${t.amount} > 0`),
    index('postings_journal_entry_id_idx').on(t.journalEntryId),
    index('postings_account_id_idx').on(t.accountId, t.id),
  ],
);

// ── Idempotency ─────────────────────────────────────────────────────────────

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    responseStatus: smallint('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    check('idempotency_keys_key_length', sql`length(${t.key}) BETWEEN 8 AND 255`),
    // Supports a retention job: keys are kept well beyond any client retry window.
    index('idempotency_keys_created_at_idx').on(t.createdAt),
  ],
);

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Posting = typeof postings.$inferSelect;
