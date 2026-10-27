import { Inject, Injectable } from '@nestjs/common';
import { IntervalJob } from '../common/jobs/interval-job';
import { ENV, Env } from '../config/env';
import { AuthorizationsService } from './authorizations.service';

/**
 * Releases holds that were never captured. Safe with several replicas: each expiry
 * re-checks the authorization under its row lock, so double processing is a no-op.
 */
@Injectable()
export class AuthorizationExpiryJob extends IntervalJob {
  protected readonly intervalMs: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly authorizations: AuthorizationsService,
  ) {
    super();
    this.intervalMs = env.AUTH_EXPIRY_SWEEP_SECONDS * 1000;
  }

  protected async run() {
    const expired = await this.authorizations.expireDue();
    if (expired > 0) this.logger.log(`released ${expired} expired authorization holds`);
  }
}
