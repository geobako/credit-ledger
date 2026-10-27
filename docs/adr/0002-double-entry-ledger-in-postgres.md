# 0002: Double-entry ledger in Postgres with database-enforced invariants

**Status:** accepted

## Context

The system must be able to answer, at any time and for any cent, _where is the money and why_.
Balances updated in place (`balance = balance - x`) lose history and can drift silently.
Floating-point money loses cents.

## Decision

- Amounts are **integer minor units**: `bigint` in Postgres, `bigint` in TypeScript (`Money`
  value object), `int64` in Go, and decimal **strings** in JSON. Rounding (basis points) is
  explicit and toward zero.
- Money moves only as **balanced journal entries** (debits = credits) over a small chart of
  accounts (customer: collateral held, card receivable, refund payable; system: collateral cash,
  operating cash, merchant payable, fee income, credit loss).
- The database enforces the rules, not just the code:
  - a deferred constraint trigger requires balance at commit;
  - triggers make entries and postings append-only (no `UPDATE`, `DELETE` or `TRUNCATE`);
  - postings must match the account's currency and be written in their entry's own
    transaction;
  - cached balances change only via the posting trigger;
  - CHECKs forbid negative customer balances and spend above the limit.
- Corrections are new reversing entries.
- Authorization holds are reservations on the credit account, not ledger entries, until
  captured.
- Drizzle ORM for typed queries; the triggers live in hand-written SQL migrations.

## Consequences

- Every balance can be recomputed from postings; reconciliation does exactly that and alarms
  on any drift.
- A bug in application code cannot unbalance the books or quietly rewrite history; it fails
  the transaction instead.
- Migrations are forward-only (no down migrations on a financial schema).
- Slightly more write volume per operation (entry + postings + cached balance update), which is
  negligible at this scale.

## Alternatives considered

- **Single-entry balance columns.** No audit trail, and drift is undetectable.
- **A dedicated ledger product** (for example TigerBeetle, or a managed ledger). It is
  excellent at scale, but a second source of truth would need a distributed protocol with the
  account state (see ADR 0001).
- **Decimal/numeric types.** They are correct, but slower and easy to mix with floats in
  JavaScript; integer minor units are the industry norm for a single-precision currency.
