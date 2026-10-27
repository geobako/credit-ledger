# 0001: One service owns the money

**Status:** accepted

## Context

The product has distinct concerns: collateral, cards, authorizations, repayments, closure,
the ledger. A microservice per concern is a common reflex. But the core invariant, _spend never
exceeds the limit derived from confirmed collateral_, spans all of them, and it is checked on
the hottest path (card authorization, with a hard network deadline).

## Decision

- **lending-api** (NestJS) is the single owner of every balance. It is a modular monolith:
  modules for collateral, cards, authorizations, repayments, closure, ledger, events and ops,
  with dependencies flowing one way. Every money-changing command is **one Postgres
  transaction**.
- **card-gateway** (Go) is a separate deployable at the card-network edge. It validates,
  rate-limits, enforces deadlines and signs requests, but holds **no balances** and makes **no
  credit decisions**.
- **web** is static files.

## Consequences

- Correctness is local: invariants are enforced by row locks and constraints in one database,
  with no 2PC, no sagas and no eventual consistency on balances.
- The gateway scales and fails independently (stateless, cheap, network-facing), and its
  failure mode is "decline", never "wrong balance".
- Scaling the money core is vertical first (Postgres), then sharding by credit account id. The
  module seams make extraction possible if it is ever justified.
- One team can reason about the whole money path.

## Alternatives considered

- **Ledger, cards and accounts as separate services.** Authorization would need a
  distributed reservation (saga with compensation, or 2PC) across services within the
  network's deadline. That means more failure modes and more latency, for no benefit at this
  scale.
- **Everything in one process, including the network edge.** It couples the network-facing
  availability/latency profile to the core, and loses the natural place for fail-closed
  timeouts and per-card throttling.
