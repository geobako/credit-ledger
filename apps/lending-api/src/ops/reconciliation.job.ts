import { Inject, Injectable } from '@nestjs/common';
import { IntervalJob } from '../common/jobs/interval-job';
import { ENV, Env } from '../config/env';
import { ReconciliationService } from './reconciliation.service';

/** Runs reconciliation on a schedule; failures surface in logs and the `reconciliation_failed_checks` metric. */
@Injectable()
export class ReconciliationJob extends IntervalJob {
  protected readonly intervalMs: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly reconciliation: ReconciliationService,
  ) {
    super();
    this.intervalMs = env.RECONCILIATION_INTERVAL_SECONDS * 1000;
  }

  protected async run() {
    await this.reconciliation.run();
  }
}
