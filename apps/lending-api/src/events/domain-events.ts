import { Injectable } from '@nestjs/common';
import type { Transaction } from '../database/database';
import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';

export interface DomainEvent {
  /** Past tense, e.g. `AuthorizationApproved`. */
  type: string;
  entityType: string;
  entityId: string;
  creditAccountId?: string | null;
  /** Business facts only: ids, amounts (as Money JSON), statuses, reasons. Never PII. */
  data: Record<string, unknown>;
}

/**
 * One call per state change, inside its transaction: an audit entry (who did what, sealed
 * into the hash chain) and an outbox event (for downstream consumers).
 */
@Injectable()
export class DomainEvents {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async emit(tx: Transaction, event: DomainEvent): Promise<void> {
    await this.audit.record(tx, {
      action: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      creditAccountId: event.creditAccountId,
      data: event.data,
    });
    await this.outbox.enqueue(tx, {
      eventType: event.type,
      aggregateType: event.entityType,
      aggregateId: event.entityId,
      payload: { ...event.data, creditAccountId: event.creditAccountId ?? null },
    });
  }
}
