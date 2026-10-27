import { Logger } from '@nestjs/common';
import { Database, Transaction } from './database';
import { findPgError, PgErrorCode } from './pg-errors';

export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  /** Total attempts for transient failures (serialization failure, deadlock). */
  maxAttempts?: number;
  readOnly?: boolean;
}

const RETRYABLE = new Set<string>([PgErrorCode.SerializationFailure, PgErrorCode.DeadlockDetected]);

/**
 * Runs a unit of work in a single database transaction, retrying it from scratch on
 * transient concurrency failures. The callback must therefore be free of side effects
 * outside the transaction (no HTTP calls, no events) — those go through the outbox.
 */
export class TransactionManager {
  private readonly logger = new Logger(TransactionManager.name);

  constructor(
    private readonly db: Database,
    private readonly onRetry: (code: string) => void = () => undefined,
  ) {}

  async run<T>(
    work: (tx: Transaction) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const { isolationLevel = 'read committed', maxAttempts = 3, readOnly = false } = options;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction(work, {
          isolationLevel,
          ...(readOnly ? { accessMode: 'read only' as const } : {}),
        });
      } catch (error) {
        const code = findPgError(error)?.code;
        if (!code || !RETRYABLE.has(code) || attempt >= maxAttempts) throw error;
        this.onRetry(code);
        this.logger.warn(`transaction retry ${attempt}/${maxAttempts - 1} after ${code}`);
        await sleep(backoffMs(attempt));
      }
    }
  }
}

function backoffMs(attempt: number): number {
  const base = 10 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * base);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
