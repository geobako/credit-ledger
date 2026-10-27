import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../database/database';
import { idempotencyKeys } from '../database/schema';
import { IdempotencyKeyReusedError } from './idempotency.errors';

export interface IdempotentRequest {
  /** Namespaces keys per caller and operation, e.g. `customer:<id>:deposits.create`. */
  scope: string;
  key: string;
  requestHash: string;
}

export interface IdempotentResponse<T = unknown> {
  status: number;
  body: T;
}

export interface IdempotentResult<T = unknown> extends IdempotentResponse<T> {
  /** True when this is a stored response from an earlier identical request. */
  replayed: boolean;
}

/**
 * Exactly-once effects for retried requests.
 *
 * The key is claimed with an INSERT inside the caller's transaction, before the work runs:
 *  - first request: the insert succeeds, the work runs, the response is stored; all commit together.
 *  - concurrent duplicate: its insert blocks on the uncommitted key row until the first transaction
 *    ends. If that committed, the insert is a no-op and the stored response is replayed. If it rolled
 *    back, the key is gone and the duplicate runs the work itself.
 *  - later duplicate: replayed straight from the table.
 * A failed request (exception → rollback) leaves no key behind, so clients can safely retry it.
 * Business outcomes that must be remembered (e.g. a declined purchase) are returned, not thrown.
 */
@Injectable()
export class IdempotencyService {
  async execute<T>(
    tx: Transaction,
    request: IdempotentRequest,
    work: () => Promise<IdempotentResponse<T>>,
  ): Promise<IdempotentResult<T>> {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ scope: request.scope, key: request.key, requestHash: request.requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      return this.replay<T>(tx, request);
    }

    const response = await work();
    // Normalise through JSON so a first response and its replays are byte-for-byte identical.
    const body = JSON.parse(JSON.stringify(response.body ?? null)) as T;
    await tx
      .update(idempotencyKeys)
      .set({ responseStatus: response.status, responseBody: body, completedAt: new Date() })
      .where(and(eq(idempotencyKeys.scope, request.scope), eq(idempotencyKeys.key, request.key)));
    return { status: response.status, body, replayed: false };
  }

  private async replay<T>(
    tx: Transaction,
    request: IdempotentRequest,
  ): Promise<IdempotentResult<T>> {
    const [stored] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, request.scope), eq(idempotencyKeys.key, request.key)));
    if (!stored || stored.responseStatus === null) {
      // Only reachable under REPEATABLE READ/SERIALIZABLE snapshots; the transaction is retried.
      throw new Error(`idempotency key ${request.key} is not visible in this snapshot`);
    }
    if (stored.requestHash !== request.requestHash) {
      throw new IdempotencyKeyReusedError(
        'this Idempotency-Key was already used with a different request',
        { key: request.key },
      );
    }
    return { status: stored.responseStatus, body: stored.responseBody as T, replayed: true };
  }
}
