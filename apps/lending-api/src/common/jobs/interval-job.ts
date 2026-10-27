import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RequestContext } from '../context/request-context';

/**
 * Base for in-process background jobs: never overlaps itself, survives failures, stops on
 * shutdown, and runs as the `system` actor so its audit entries are attributed correctly.
 * Correctness never depends on a single instance: every job is safe to run on many replicas.
 */
export abstract class IntervalJob implements OnApplicationBootstrap, OnApplicationShutdown {
  protected readonly logger = new Logger(this.constructor.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  /** Milliseconds between runs; 0 disables the job. */
  protected abstract readonly intervalMs: number;
  protected abstract run(): Promise<void>;

  onApplicationBootstrap() {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await RequestContext.run({ type: 'system', id: this.constructor.name }, () => this.run());
    } catch (error) {
      this.logger.error({ err: error }, 'background job failed');
    } finally {
      this.running = false;
    }
  }
}
