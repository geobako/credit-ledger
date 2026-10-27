import { DomainError } from '../common/errors/domain-error';

export class InvalidJournalEntryError extends DomainError {
  readonly code = 'LEDGER_INVALID_ENTRY';
}

export class InsufficientBalanceError extends DomainError {
  readonly code = 'LEDGER_INSUFFICIENT_BALANCE';
}

export class DuplicateJournalEntryError extends DomainError {
  readonly code = 'LEDGER_DUPLICATE_ENTRY';
}

export class LedgerAccountNotFoundError extends DomainError {
  readonly code = 'LEDGER_ACCOUNT_NOT_FOUND';
}
