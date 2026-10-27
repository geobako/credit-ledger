import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { OutboxEvent, outboxEvents } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/** Where integration events go: a log locally, SNS/EventBridge/Kafka in the cloud. */
export interface EventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

@Injectable()
export class LogEventPublisher implements EventPublisher {
  private readonly logger = new Logger('DomainEvents');

  publish(event: OutboxEvent): Promise<void> {
    this.logger.log(
      { eventId: event.id, type: event.eventType, aggregateId: event.aggregateId },
      'event published',
    );
    return Promise.resolve();
  }
}

export interface OutboxMessage {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

const MAX_BACKOFF_SECONDS = 300;

/**
 * Transactional outbox: events are written in the same transaction as the state change, so
 * an event is published if and only if the change committed (no dual write). A relay
 * delivers them at-least-once; the event id lets consumers deduplicate.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly tx: TransactionManager,
  ) {}

  async enqueue(tx: Transaction, message: OutboxMessage): Promise<void> {
    await tx.insert(outboxEvents).values({
      ...message,
      payload: JSON.parse(JSON.stringify(message.payload)) as Record<string, unknown>,
    });
  }

  /**
   * Publishes due events in order. SKIP LOCKED lets several relays share the work without
   * blocking each other; a failure backs the event off exponentially without stalling others.
   */
  relay(batchSize = 100): Promise<{ published: number; failed: number }> {
    return this.tx.run(async (tx) => {
      const due = await tx
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.availableAt, new Date())))
        .orderBy(asc(outboxEvents.seq))
        .limit(batchSize)
        .for('update', { skipLocked: true });

      let published = 0;
      let failed = 0;
      for (const event of due) {
        try {
          await this.publisher.publish(event);
          await tx
            .update(outboxEvents)
            .set({ publishedAt: new Date(), lastError: null })
            .where(eq(outboxEvents.id, event.id));
          published++;
        } catch (error) {
          failed++;
          const delay = Math.min(MAX_BACKOFF_SECONDS, 2 ** event.attempts);
          await tx
            .update(outboxEvents)
            .set({
              attempts: event.attempts + 1,
              lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
              availableAt: sql`now() + make_interval(secs => ${delay})`,
            })
            .where(eq(outboxEvents.id, event.id));
          this.logger.warn(
            { eventId: event.id, attempts: event.attempts + 1 },
            'event publish failed',
          );
        }
      }
      return { published, failed };
    });
  }

  async backlog(): Promise<{ pending: number; oldestPendingSeconds: number | null }> {
    const [row] = await this.db
      .select({
        pending: sql<number>`count(*)::int`,
        oldest: sql<
          number | null
        >`extract(epoch FROM now() - min(${outboxEvents.occurredAt}))::float`,
      })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt));
    return { pending: row?.pending ?? 0, oldestPendingSeconds: row?.oldest ?? null };
  }

  async list(status: 'pending' | 'published', limit = 100) {
    return this.db
      .select()
      .from(outboxEvents)
      .where(
        status === 'pending'
          ? isNull(outboxEvents.publishedAt)
          : sql`${outboxEvents.publishedAt} IS NOT NULL`,
      )
      .orderBy(sql`${outboxEvents.seq} DESC`)
      .limit(limit);
  }
}
