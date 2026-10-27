import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Prometheus metrics. Labels are low-cardinality by construction (no ids, no amounts). */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route template',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly authorizationDecisions = new Counter({
    name: 'card_authorization_decisions_total',
    help: 'Authorization decisions by outcome and decline reason',
    labelNames: ['outcome', 'reason'] as const,
    registers: [this.registry],
  });

  readonly authorizationLatency = new Histogram({
    name: 'card_authorization_duration_seconds',
    help: 'Time to decide an authorization, including the database transaction',
    buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
    registers: [this.registry],
  });

  readonly paymentWebhooks = new Counter({
    name: 'payment_webhooks_total',
    help: 'Payment provider events by processing outcome',
    labelNames: ['outcome', 'duplicate'] as const,
    registers: [this.registry],
  });

  readonly transactionRetries = new Counter({
    name: 'db_transaction_retries_total',
    help: 'Transactions retried after a serialization failure or deadlock',
    labelNames: ['code'] as const,
    registers: [this.registry],
  });

  readonly outboxPending = new Gauge({
    name: 'outbox_pending_events',
    help: 'Domain events waiting to be published',
    registers: [this.registry],
  });

  readonly outboxOldestPendingSeconds = new Gauge({
    name: 'outbox_oldest_pending_seconds',
    help: 'Age of the oldest unpublished domain event',
    registers: [this.registry],
  });

  readonly reconciliationFailedChecks = new Gauge({
    name: 'reconciliation_failed_checks',
    help: 'Number of failing checks in the last reconciliation run (alert on > 0)',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
