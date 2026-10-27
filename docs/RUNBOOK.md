# Runbook

What to do when an alarm fires. Alarms are defined in
[`infra/terraform/observability.tf`](../infra/terraform/observability.tf) and go to the
`<env>-alarms` SNS topic.

General first steps: find the `requestId` in the alarm's log lines. It correlates the API logs,
the gateway logs (`request_id`), and the `audit_log.request_id` rows.

## Reconciliation failed

**Alarm:** `reconciliation-failed`. Severity: **page immediately**. The stored numbers
disagree with the ledger.

1. Run it again to see the current state (it is read-only and safe):
   `GET /v1/ops/reconciliation` as an ops user, or _Ops console → Reconciliation → Run now_.
   Each failing check lists up to 20 discrepancies.
2. **Do not "fix" balances with SQL.** The ledger triggers will refuse anyway. Corrections are
   reversing journal entries made through the application.
3. By check:
   - `ledger_balance_drift` or `ledger_trial_balance`: cached balances or postings were altered
     outside the posting trigger. Treat as a **security incident**: check
     `pg_stat_activity` / RDS logs for direct DB sessions, and CloudTrail for credential use.
   - `outstanding_matches_ledger`, `holds_match_authorizations`, `limit_matches_collateral`:
     the account state and the ledger diverged, most likely a code defect. Freeze affected
     cards (`POST /v1/cards/{id}/freeze`), then find the triggering request via the account's
     audit trail (`/v1/ops/audit?creditAccountId=…`).
   - `collateral_segregation`: segregated cash ≠ collateral owed. Escalate to finance.
   - `audit_chain_intact`: see [Audit chain broken](#audit-chain-broken).
   - `outbox_flowing`: see [Outbox backlog](#outbox-backlog).

## Audit chain broken

`GET /v1/ops/audit/verify` returns `ok: false` with `brokenAt` and a reason. A row inside the
sealed chain was changed, inserted or removed. Treat as a **security incident**: preserve the
database (snapshot), compare against the latest backup at that position, review direct DB
access. Do not reseal.

## Timeout reversal needs review

**Alarm:** `gateway-reversal-needs-review`. The gateway declined an authorization (fail closed),
and could not confirm that no hold was left behind: the queue was full, the process stopped
mid-retry, or the API refused the reversal.

1. Take the `network_transaction_id` from the log line.
2. Find the authorization (read-only query on a replica or via a break-glass session):
   `SELECT id, status, credit_account_id FROM authorizations WHERE network_transaction_id = '…'`.
   No row means the API never processed it, so there is nothing to do.
3. If it is `HELD`, reverse it through the gateway as the network would:
   `POST /v1/authorizations/{id}/reversal` (idempotent). If it is `CAPTURED`, the network
   settled it anyway; it is a valid purchase.
4. If left alone, the hold expires automatically after `AUTH_HOLD_TTL_MINUTES` (7 days).

## Authorization latency (p99 > 500 ms)

Above ~1.5 s the gateway starts declining with `91`, which customers notice.

1. Database: CPU, connections, Performance Insights top waits. `Lock:tuple` /
   `Lock:transactionid` means contention; check `log_lock_waits` lines for the account.
2. API: `card_authorization_duration_seconds`, `db_transaction_retries_total`, and 503
   `ACCOUNT_BUSY` responses (one account being hammered; the gateway's per-card limiter should
   already throttle it).
3. Scale: ECS autoscaling handles CPU; if the database is the bottleneck, scale the instance
   (Multi-AZ makes this a failover-length blip).

## 5xx rate / unhandled errors

`api-unhandled-errors` counts errors the API didn't expect (`unhandled error` log lines, full
stack included). A deploy just happened → let the circuit breaker roll back, or redeploy the
previous SHA. Otherwise correlate by `requestId`. Money is safe by construction: the failed
transaction rolled back, and the client retries idempotently.

## Healthy hosts below 2

One more failure is an outage. Check ECS service events (task stopped reasons: OOM, failed
health checks, image pull), then the last deployment. For the gateway, check that the API is
reachable: the gateway stays _ready_ with an open breaker by design.

## Outbox backlog

`outbox_oldest_pending_seconds` is growing, or reconciliation's `outbox_flowing` failed. Events
are safe in the table; nothing is lost. Check the relay logs for `event publish failed` (the
publisher, i.e. the broker, is down) and the `attempts` / `last_error` columns
(`GET /v1/ops/outbox?status=pending`). It drains on its own when the broker recovers.

## Database

- **CPU / connections:** see authorization latency. Connections ≈ tasks × 20.
- **Free storage:** autoscaling grows storage up to 10× the initial size; if near the ceiling,
  raise `db_allocated_storage`.
- **Failover:** automatic (Multi-AZ). Expect 1–2 minutes of errors; clients retry
  idempotently; the gateway fails closed meanwhile. After failover, run reconciliation.
