import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Principal } from '../auth/principal';
import { DomainError } from '../common/errors/domain-error';
import { CreditAccountsService } from '../credit-accounts/credit-accounts.service';
import type { Database } from '../database/database';
import { DB } from '../database/database.module';
import { Card, cards } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';

export class CardNotFoundError extends DomainError {
  readonly code = 'CARD_NOT_FOUND';
  readonly kind = 'not_found';
}

export class CardStateError extends DomainError {
  readonly code = 'CARD_STATE_CONFLICT';
  readonly kind = 'conflict';
}

/**
 * Card freeze/unfreeze. Both are idempotent by state (freezing a frozen card is a no-op), so
 * they need no Idempotency-Key. They take the credit account lock, like authorizations, so a
 * freeze and a purchase on the same card are strictly ordered.
 */
@Injectable()
export class CardsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tx: TransactionManager,
    private readonly accounts: CreditAccountsService,
  ) {}

  freeze(principal: Principal, cardId: string) {
    return this.transition(principal, cardId, 'ACTIVE', 'FROZEN');
  }

  unfreeze(principal: Principal, cardId: string) {
    return this.transition(principal, cardId, 'FROZEN', 'ACTIVE');
  }

  /** Loads a card the caller may see (someone else's card reads as not found). */
  async findAccessible(principal: Principal, cardId: string): Promise<Card> {
    const [card] = await this.db.select().from(cards).where(eq(cards.id, cardId));
    if (!card) throw new CardNotFoundError('card not found');
    try {
      await this.accounts.findAccessible(this.db, principal, card.creditAccountId);
    } catch {
      throw new CardNotFoundError('card not found');
    }
    return card;
  }

  private async transition(
    principal: Principal,
    cardId: string,
    from: Card['status'],
    to: Card['status'],
  ) {
    const visible = await this.findAccessible(principal, cardId);
    return this.tx.run(async (tx) => {
      await this.accounts.lock(tx, visible.creditAccountId);
      const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
      if (card!.status === to) return present(card!);
      if (card!.status !== from) {
        throw new CardStateError(
          `a ${card!.status.toLowerCase()} card cannot be ${to === 'FROZEN' ? 'frozen' : 'unfrozen'}`,
        );
      }
      const [updated] = await tx
        .update(cards)
        .set({ status: to })
        .where(eq(cards.id, cardId))
        .returning();
      return present(updated!);
    });
  }
}

export function present(card: Card) {
  return {
    id: card.id,
    creditAccountId: card.creditAccountId,
    status: card.status,
    last4: card.last4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
  };
}
