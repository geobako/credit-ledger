# 0006: The card gateway fails closed and compensates late approvals

**Status:** accepted

## Context

Card networks require an answer within a deadline. If the issuer can't decide in time, the
safe answer is "decline": a declined purchase can be retried by the cardholder, while an
approval the issuer can't stand behind is a loss. But a timed-out request may still be
processed by the API after the gateway has given up, leaving a hold for a purchase the network
was told was declined.

## Decision

- The gateway gives the API **1.5 s**. On timeout, connection error or 5xx it answers `91`
  (issuer unavailable).
- It then **enqueues a compensating reversal**: a worker replays the _identical_ authorization
  (safe: the API is idempotent on the network transaction id). If the replayed answer is
  "approved", the worker reverses the hold.
- **Stand-in memory:** retransmissions of a transaction that got a stand-in decline keep getting
  `91`, so the network is never told "approved" for a hold being reversed.
- A **circuit breaker** stops sending to an API that is failing (instant `91`, single probe after
  a cool-down). A **per-card token bucket** throttles card testing.

## Consequences

- No customer is left with a hold for a declined purchase. This was verified in a live drill
  (API paused mid-request: declined in 1.55 s, late approval reversed, held amount 0).
- If the API was fully down, the replay _creates_ an approval and then reverses it. That is
  correct but noisy; a "reverse by network transaction id" endpoint would avoid it
  (follow-up).
- The compensation queue is in memory. It drains on graceful shutdown; on a hard crash,
  anything pending is lost, and the stray hold expires on its own (default 7 days). Production
  should make it durable (SQS). This limitation is stated and alarmed.

## Alternatives considered

- **Fail open (approve when unsure).** That is unbounded credit risk; it is never acceptable
  for a secured product.
- **Synchronous retry inside the deadline.** It burns the deadline and still needs
  compensation for the last attempt.
- **Two-phase reservation with the network.** It isn't how card authorization works; the
  network message is the request.
