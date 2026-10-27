import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  CollateralService,
  SANDBOX_PROVIDER,
  SettlementOutcome,
} from '../collateral/collateral.service';
import { DomainError } from '../common/errors/domain-error';
import { CURRENCIES, Money } from '../common/money/money';
import { ENV, Env } from '../config/env';
import { webhookEvents } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { RepaymentOutcome, RepaymentsService } from '../repayments/repayments.service';
import { verifyWebhookSignature } from './webhook-signature';

export class InvalidWebhookPayloadError extends DomainError {
  readonly code = 'INVALID_WEBHOOK_PAYLOAD';
  readonly kind = 'validation';
}

const paymentEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  data: z.object({
    reference: z.string().min(1).max(255),
    amount: z.string().regex(/^\d{1,15}$/),
    currency: z.enum(CURRENCIES),
    failure_reason: z.string().max(255).optional(),
  }),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export interface WebhookAck {
  received: true;
  duplicate: boolean;
  outcome: SettlementOutcome | RepaymentOutcome | 'IGNORED' | null;
}

/**
 * Inbound payment-provider events. Verified (signature + freshness) before parsing, deduplicated
 * by provider event id, and applied in the same transaction as the dedup record, so a
 * redelivered or concurrently delivered event can never be applied twice.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly tx: TransactionManager,
    private readonly collateral: CollateralService,
    private readonly repayments: RepaymentsService,
  ) {}

  async handlePaymentEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookAck> {
    if (!rawBody) throw new InvalidWebhookPayloadError('empty webhook body');
    verifyWebhookSignature(
      this.env.WEBHOOK_SECRET,
      rawBody,
      signature,
      this.env.WEBHOOK_TOLERANCE_SECONDS,
    );

    let event: PaymentEvent;
    try {
      event = paymentEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new InvalidWebhookPayloadError('webhook payload is not a valid payment event');
    }

    return this.tx.run(async (tx) => {
      const recorded = await tx
        .insert(webhookEvents)
        .values({ id: event.id, provider: SANDBOX_PROVIDER, type: event.type, payload: event })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (recorded.length === 0) {
        const [previous] = await tx
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.id, event.id));
        return {
          received: true,
          duplicate: true,
          outcome: (previous?.outcome ?? null) as WebhookAck['outcome'],
        };
      }

      let outcome: WebhookAck['outcome'];
      if (event.type === 'payment.succeeded' || event.type === 'payment.failed') {
        const settlement = {
          reference: event.data.reference,
          outcome:
            event.type === 'payment.succeeded' ? ('succeeded' as const) : ('failed' as const),
          amount: Money.of(event.data.amount, event.data.currency),
          failureReason: event.data.failure_reason,
        };
        // An incoming payment is either a collateral deposit or a repayment, told apart by reference.
        outcome = await this.collateral.settle(tx, settlement);
        if (outcome === 'UNKNOWN_REFERENCE') outcome = await this.repayments.settle(tx, settlement);
      } else {
        outcome = 'IGNORED';
      }
      if (outcome === 'UNKNOWN_REFERENCE') {
        this.logger.warn({ eventId: event.id }, 'payment event for an unknown reference');
      }
      await tx.update(webhookEvents).set({ outcome }).where(eq(webhookEvents.id, event.id));
      return { received: true, duplicate: false, outcome };
    });
  }
}
