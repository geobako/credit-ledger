import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { DomainEvents } from './domain-events';
import { AuditSealerJob, OutboxRelayJob } from './event-jobs';
import { EVENT_PUBLISHER, LogEventPublisher, OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [
    AuditService,
    OutboxService,
    DomainEvents,
    AuditSealerJob,
    OutboxRelayJob,
    { provide: EVENT_PUBLISHER, useClass: LogEventPublisher },
  ],
  exports: [AuditService, OutboxService, DomainEvents],
})
export class EventsModule {}
