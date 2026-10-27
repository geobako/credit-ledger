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

// ── Purchase authorizations ─────────────────────────────────────────────────

export const authorizationStatus = pgEnum('authorization_status', [
  'HELD', // approved, amount reserved against the limit
  'CAPTURED', // settled by the network: now owed by the customer
  'REVERSED', // cancelled by the merchant/network: hold released
  'EXPIRED', // never captured in time: hold released
  'DECLINED', // refused; kept for the customer's history and audit
]);

export const authorizations = pgTable(
  'authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditAccountId: uuid('credit_account_id')
      .notNull()
      .references(() => creditAccounts.id),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    /** Card network's id for this authorization: the natural idempotency key. */
    networkTransactionId: text('network_transaction_id').notNull().unique(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: authorizationStatus('status').notNull(),
    declineReason: text('decline_reason'),
    merchantName: text('merchant_name').notNull(),
    merchantCategoryCode: char('merchant_category_code', { length: 4 }),
    capturedAmount: bigint('captured_amount', { mode: 'bigint' }),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    check('authorizations_amount_positive', sql`${t.amount} > 0`),
    check(
      'authorizations_capture_within_hold',
      sql`${t.capturedAmount} IS NULL OR (${t.capturedAmount} > 0 AND ${t.capturedAmount} <= ${t.amount})`,
    ),
    check(
      'authorizations_captured_consistent',
      sql`(${t.status} = 'CAPTURED') = (${t.capturedAmount} IS NOT NULL AND ${t.journalEntryId} IS NOT NULL)`,
    ),
    check(
      'authorizations_declined_has_reason',
      sql`(${t.status} = 'DECLINED') = (${t.declineReason} IS NOT NULL)`,
    ),
    index('authorizations_credit_account_id_idx').on(t.creditAccountId, t.createdAt),
    // Expiry sweep: only open holds are scanned.
    index('authorizations_held_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'HELD'`),
  ],
);

// ── Repayments ──────────────────────────────────────────────────────────────

export const repaymentStatus = pgEnum('repayment_status', [
  'PENDING',
  'SETTLED',
  'FAILED',
  /** Funds arrived but could not be applied (e.g. account closed): refunded by operations. */
  'REJECTED',
]);

export const repayments = pgTable(
  'repayments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditAccountId: uuid('credit_account_id')
      .notNull()
      .references(() => creditAccounts.id),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: repaymentStatus('status').notNull().default('PENDING'),
    providerReference: text('provider_reference').notNull().unique(),
    /** Part of the payment that reduced the debt. */
    appliedAmount: bigint('applied_amount', { mode: 'bigint' }),
    /** Part that exceeded the debt at settlement: owed back to the customer. */
    excessAmount: bigint('excess_amount', { mode: 'bigint' }),
    failureReason: text('failure_reason'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    check('repayments_amount_positive', sql`${t.amount} > 0`),
    check(
      'repayments_settled_consistent',
      sql`(${t.status} = 'SETTLED') = (${t.journalEntryId} IS NOT NULL AND ${t.appliedAmount} IS NOT NULL AND ${t.excessAmount} IS NOT NULL)`,
    ),
    check(
      'repayments_split_adds_up',
      sql`${t.appliedAmount} IS NULL OR ${t.appliedAmount} + ${t.excessAmount} = ${t.amount}`,
    ),
    index('repayments_credit_account_id_idx').on(t.creditAccountId),
  ],
);

// ── Account closure ─────────────────────────────────────────────────────────

export const closureReason = pgEnum('closure_reason', ['CUSTOMER_REQUEST', 'CHARGE_OFF']);

/** How the books were settled when an account closed. One per account. */
export const accountClosures = pgTable(
  'account_closures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditAccountId: uuid('credit_account_id')
      .notNull()
      .unique()
      .references(() => creditAccounts.id),
    reason: closureReason('reason').notNull(),
    initiatedBy: uuid('initiated_by')
      .notNull()
      .references(() => users.id),
    debtAtClosure: bigint('debt_at_closure', { mode: 'bigint' }).notNull(),
    refundApplied: bigint('refund_applied', { mode: 'bigint' }).notNull(),
    collateralApplied: bigint('collateral_applied', { mode: 'bigint' }).notNull(),
    writtenOff: bigint('written_off', { mode: 'bigint' }).notNull(),
    /** Returned to the customer: unused collateral plus any overpayment. Paid out by the provider. */
    payoutAmount: bigint('payout_amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'account_closures_debt_settled',
      sql`${t.refundApplied} + ${t.collateralApplied} + ${t.writtenOff} = ${t.debtAtClosure}`,
    ),
    check(
      'account_closures_non_negative',
      sql`${t.debtAtClosure} >= 0 AND ${t.refundApplied} >= 0 AND ${t.collateralApplied} >= 0 AND ${t.writtenOff} >= 0 AND ${t.payoutAmount} >= 0`,
    ),
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
export type Authorization = typeof authorizations.$inferSelect;
export type Repayment = typeof repayments.$inferSelect;
export type AccountClosure = typeof accountClosures.$inferSelect;
