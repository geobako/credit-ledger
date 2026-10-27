# 0003: Pessimistic locking per credit account, plus a per-account queue

**Status:** accepted (amended after load testing)

## Context

Concurrent requests on one account are expected: a customer double-tapping, a merchant
retrying, a card-testing attack firing dozens of authorizations at once. The invariant
`outstanding + holds <= limit` must hold under any interleaving, including across multiple API
replicas.

## Decision

1. **The credit account row is the lock.** Every money-changing command starts with
   `SELECT … FOR UPDATE` on `credit_accounts` and reads everything else under it. Lock order
   is always account → entity → ledger accounts (sorted), which rules out deadlocks.
2. A **CHECK constraint** (`outstanding_balance + held_amount <= credit_limit`) is the last line
   of defence if code ever forgot the lock.
3. Transactions retry automatically on `40001` and `40P01`.
4. **Amendment:** a `KeyedSerializer` queues same-account work **in memory before taking a pool
   connection** (at most one in-flight transaction per account per process; it sheds with 503
   beyond 100 queued).

## Why the amendment

The k6 load test showed that with locks alone, 25 concurrent requests for one card each held a
pool connection while waiting on the row lock, exhausting the pool (20) and stalling every
other account: gateway p95 went from 7 ms to 536 ms. With the queue, under the same load:
gateway p95 7 ms, hot card p95 64 ms, throughput 3.3× higher.

## Consequences

- Strict per-account ordering; simple reasoning; correct across replicas (the DB lock), fair
  within a replica (the queue).
- Per-account throughput is bounded by lock hold time (a few ms), which is far above any
  legitimate card's needs.
- The queue is per process: N replicas can still hold up to N connections for one hot
  account, which is bounded and acceptable.

## Alternatives considered

- **Optimistic concurrency (version column + retry).** Under the contention that matters
  (bursts on one card), it degrades into retry storms and tail latency on the deadline-bound
  path.
- **SERIALIZABLE isolation.** It is correct, but contention would surface as serialization
  failures and retries for the same reason; explicit locks state the intent.
- **Conditional single-statement updates** (`UPDATE … SET held = held + x WHERE held + x <=
limit`). This is fast for the authorization itself, but the decision also depends on card
  status, expiry and idempotency state that must be read consistently. The row lock covers all
  of it.
