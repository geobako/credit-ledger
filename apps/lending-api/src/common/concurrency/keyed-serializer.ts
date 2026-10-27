import { DomainError } from '../errors/domain-error';

export class SerializerQueueFullError extends DomainError {
  readonly code = 'ACCOUNT_BUSY';
  readonly kind = 'unavailable';
}

/**
 * Runs tasks one at a time per key, in arrival order, without blocking other keys.
 *
 * Why: every money movement on a credit account takes that account's row lock. If 25 requests
 * for one hot card arrive together, each would check out a pool connection and sit waiting on
 * the lock, and a pool of 20 is gone: every other customer's purchase then queues behind one
 * busy card. Queueing same-account work in memory first means each process holds at most one
 * connection per account. The database lock still provides correctness (including across
 * processes); this only stops one account from starving the pool.
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, { tail: Promise<unknown>; depth: number }>();

  constructor(private readonly maxDepth: number) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const entry = this.tails.get(key) ?? { tail: Promise.resolve(), depth: 0 };
    if (entry.depth >= this.maxDepth) {
      throw new SerializerQueueFullError('too many concurrent requests for this account; retry');
    }
    entry.depth++;
    const previous = entry.tail;
    const result = previous.then(task, task);
    // The chain must survive a failed task, so the next one still runs.
    entry.tail = result.catch(() => undefined);
    this.tails.set(key, entry);
    try {
      return await result;
    } finally {
      if (--entry.depth === 0) this.tails.delete(key);
    }
  }

  /** Keys with work queued or running. */
  get activeKeys(): number {
    return this.tails.size;
  }
}
