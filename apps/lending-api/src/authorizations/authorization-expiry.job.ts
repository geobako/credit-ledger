import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { AuthorizationsService } from './authorizations.service';

/**
 * Periodically releases holds that were never captured. Safe with several replicas: each
 * expiry re-checks the authorization under its row lock, so double processing is a no-op.
 */
@Injectable()
export class AuthorizationExpiryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuthorizationExpiryJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly authorizations: AuthorizationsService,
  ) {}

  onApplicationBootstrap() {
    if (this.env.AUTH_EXPIRY_SWEEP_SECONDS === 0) return;
    this.timer = setInterval(() => void this.sweep(), this.env.AUTH_EXPIRY_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.authorizations.expireDue();
      if (expired > 0) this.logger.log(`released ${expired} expired authorization holds`);
    } catch (error) {
      this.logger.error({ err: error }, 'authorization expiry sweep failed');
    } finally {
      this.running = false;
    }
  }
}
