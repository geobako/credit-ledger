# 0004: Idempotency records in the same transaction as the effect

**Status:** accepted

## Context

Every caller retries: browsers on flaky networks, the gateway after timeouts, card networks
retransmitting, payment providers redelivering webhooks (at-least-once). Applying a deposit,
purchase or repayment twice is a money bug.

## Decision

- Money-moving customer endpoints **require** an `Idempotency-Key`. Keys are scoped to the
  caller and operation, and stored with a hash of the request.
- The key is claimed with `INSERT … ON CONFLICT DO NOTHING` **inside the same transaction** that
  performs the effect and stores the response. If the insert conflicts, the stored response is
  replayed (`Idempotent-Replayed: true`). A concurrent duplicate blocks on the unique index
  until the first transaction commits, then replays. The same key with a different request →
  `422`.
- Natural keys where they exist: the network transaction id for authorizations, the provider
  event id for webhooks (plus the payment's own state, so a re-issued event for a settled
  payment is a no-op).
- Capture, reversal, freeze and unfreeze are idempotent by state.

## Consequences

- "Exactly-once effect" without distributed coordination: the effect and its record commit or
  roll back together, so a crash can't leave one without the other.
- Keys and webhook records accumulate. They need a retention policy (partition and drop
  beyond the retry window), which is listed as follow-up work.
- Clients must generate keys per _intent_. The web app does, and reuses the key for retries.

## Alternatives considered

- **Idempotency check in a cache (Redis) before the transaction.** This leaves a race window
  between the check and the commit, and a crash between the effect and the cache write
  breaks it.
- **Unique constraints on business fields only.** They don't cover "same request, replay the
  same response", and can't detect a reused key with a different payload.
