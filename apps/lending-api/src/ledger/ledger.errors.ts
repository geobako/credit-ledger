import { DomainError } from '../common/errors/domain-error';

export class InvalidJournalEntryError extends DomainError {
  readonly code = 'LEDGER_INVALID_ENTRY';
  readonly kind = 'invariant';
}

export class InsufficientBalanceError extends DomainError {
  readonly code = 'LEDGER_INSUFFICIENT_BALANCE';
  readonly kind = 'unprocessable';
}

export class DuplicateJournalEntryError extends DomainError {
  readonly code = 'LEDGER_DUPLICATE_ENTRY';
  readonly kind = 'conflict';
}

export class LedgerAccountNotFoundError extends DomainError {
  readonly code = 'LEDGER_ACCOUNT_NOT_FOUND';
  readonly kind = 'not_found';
}
