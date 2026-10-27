import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

// ── Identity ────────────────────────────────────────────────────────────────

export const userRole = pgEnum('user_role', ['customer', 'ops']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRole('role').notNull().default('customer'),
  createdAt: createdAt(),
});

// ── Credit accounts & cards ─────────────────────────────────────────────────
//
// Lock hierarchy (always acquired in this order to rule out deadlocks):
//   credit_accounts row  →  collateral_deposits / authorizations rows  →  ledger accounts (via postings)

export const creditAccountStatus = pgEnum('credit_account_status', [
  'PENDING_COLLATERAL',
  'ACTIVE',
  'CLOSED',
]);

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    status: creditAccountStatus('status').notNull().default('PENDING_COLLATERAL'),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    /** Share of confirmed collateral granted as credit, in basis points (10_000 = 100%). */
    advanceRateBps: integer('advance_rate_bps').notNull(),
    creditLimit: bigint('credit_limit', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Mirror of the CARD_RECEIVABLE ledger balance, kept in the same transaction (reconciled). */
    outstandingBalance: bigint('outstanding_balance', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Sum of open authorization holds. */
    heldAmount: bigint('held_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    // At most one open credit account per customer.
    uniqueIndex('credit_accounts_one_open_per_customer')
      .on(t.customerId)
      .where(sql`${t.status} <> 'CLOSED'`),
    check('credit_accounts_advance_rate', sql`${t.advanceRateBps} BETWEEN 0 AND 10000`),
    check(
      'credit_accounts_amounts_non_negative',
      sql`${t.creditLimit} >= 0 AND ${t.outstandingBalance} >= 0 AND ${t.heldAmount} >= 0`,
    ),
    // The core lending invariant, enforced by the database as the last line of defence:
    // spending plus open holds can never exceed the limit.
    check(
      'credit_accounts_within_limit',
      sql`${t.outstandingBalance} + ${t.heldAmount} <= ${t.creditLimit}`,
    ),
  ],
);

export const cardStatus = pgEnum('card_status', ['INACTIVE', 'ACTIVE', 'FROZEN', 'CLOSED']);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditAccountId: uuid('credit_account_id')
      .notNull()
      .references(() => creditAccounts.id),
    status: cardStatus('status').notNull().default('INACTIVE'),
    /** We never store a PAN: only the last four digits and the processor's opaque token. */
    last4: char('last4', { length: 4 }).notNull(),
    networkToken: text('network_token').notNull().unique(),
    expiryMonth: smallint('expiry_month').notNull(),
    expiryYear: smallint('expiry_year').notNull(),
    createdAt: createdAt(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [index('cards_credit_account_id_idx').on(t.creditAccountId)],
);

// ── Collateral ──────────────────────────────────────────────────────────────

export const depositStatus = pgEnum('deposit_status', [
  'PENDING',
  'CONFIRMED',
  'FAILED',
  /** Funds arrived but could not be accepted (e.g. account closed): refunded by operations. */
  'REJECTED',
]);

export const collateralDeposits = pgTable(
  'collateral_deposits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditAccountId: uuid('credit_account_id')
      .notNull()
      .references(() => creditAccounts.id),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: depositStatus('status').notNull().default('PENDING'),
    /** Payment provider's reference for the incoming transfer. */
    providerReference: text('provider_reference').notNull().unique(),
    failureReason: text('failure_reason'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    check('collateral_deposits_amount_positive', sql`${t.amount} > 0`),
    check(
      'collateral_deposits_confirmed_has_entry',
      sql`(${t.status} = 'CONFIRMED') = (${t.journalEntryId} IS NOT NULL)`,
    ),
    index('collateral_deposits_credit_account_id_idx').on(t.creditAccountId),
  ],
);

// ── Inbound webhooks ────────────────────────────────────────────────────────

export const webhookEvents = pgTable('webhook_events', {
  /** Provider's event id: a redelivered event is recognised and not processed twice. */
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  outcome: text('outcome'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Posting = typeof postings.$inferSelect;
export type User = typeof users.$inferSelect;
export type CreditAccount = typeof creditAccounts.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type CollateralDeposit = typeof collateralDeposits.$inferSelect;
