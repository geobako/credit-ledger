import { Inject, Injectable } from '@nestjs/common';
import { IntervalJob } from '../common/jobs/interval-job';
import { ENV, Env } from '../config/env';
import { Metrics } from '../metrics/metrics';
import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';

/** Seals new audit entries into the hash chain. Replicas serialise on an advisory lock. */
@Injectable()
export class AuditSealerJob extends IntervalJob {
  protected readonly intervalMs: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly audit: AuditService,
  ) {
    super();
    this.intervalMs = env.AUDIT_SEAL_INTERVAL_MS;
  }

  protected async run() {
    while ((await this.audit.seal()) > 0) {
      // keep sealing while there is a backlog
    }
  }
}

/** Publishes outbox events. Replicas share the work through SKIP LOCKED. */
@Injectable()
export class OutboxRelayJob extends IntervalJob {
  protected readonly intervalMs: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly outbox: OutboxService,
    private readonly metrics: Metrics,
  ) {
    super();
    this.intervalMs = env.OUTBOX_RELAY_INTERVAL_MS;
  }

  protected async run() {
    for (;;) {
      const { published, failed } = await this.outbox.relay();
      if (published === 0 || failed > 0) break;
    }
    const backlog = await this.outbox.backlog();
    this.metrics.outboxPending.set(backlog.pending);
    this.metrics.outboxOldestPendingSeconds.set(backlog.oldestPendingSeconds ?? 0);
  }
}
