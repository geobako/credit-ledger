# 0005: Transactional outbox and hash-chained audit log

**Status:** accepted

## Context

Other systems (notifications, bureau reporting, analytics) need to learn about changes.
Writing to the database and then publishing to a broker is a dual write: one can succeed
without the other. Separately, a lender must be able to show who did what, and prove the
record wasn't altered.

## Decision

- **Outbox.** Domain events are inserted into `outbox_events` in the same transaction as the
  change. A relay publishes them at-least-once using `FOR UPDATE SKIP LOCKED`, so replicas share
  the work, with exponential backoff and `available_at` scheduling. The event id is the
  consumers' deduplication key. The publisher is an interface; locally it logs.
- **Audit log.** Every state change writes an audit row (actor, action, entity, request id,
  payload) in the same transaction. A sealer job chains new rows:
  `hash = sha256(prev_hash ‖ position ‖ canonical row)`. A trigger makes rows immutable apart
  from that one-time seal. Verification recomputes the chain; reconciliation includes it.

## Consequences

- No lost or phantom events; consumers must be idempotent (they get the event id to make that
  easy).
- Any edit, insertion or deletion inside the sealed chain is detectable, and the break is
  located exactly.
- Sealing is asynchronous (sub-second), so the newest entries are briefly unsealed; the
  verification output reports how many.
- Tamper-_evidence_, not tamper-_proofing_: a superuser who rewrites the entire chain could
  recompute it. Mitigation in production: periodically anchor the latest hash outside the
  database (e.g. S3 Object Lock / WORM).

## Alternatives considered

- **CDC (Debezium) on the tables.** It is powerful, but publishes row changes rather than
  domain events, and adds infrastructure.
- **Publishing directly from the request.** That is the dual-write problem.
- **Audit via database triggers only.** These lose the business actor and request context
  that the application knows.
