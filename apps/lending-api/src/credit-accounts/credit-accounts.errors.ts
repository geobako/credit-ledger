import { DomainError } from '../common/errors/domain-error';

export class CreditAccountNotFoundError extends DomainError {
  readonly code = 'CREDIT_ACCOUNT_NOT_FOUND';
  readonly kind = 'not_found';
}

export class CreditAccountAlreadyOpenError extends DomainError {
  readonly code = 'CREDIT_ACCOUNT_ALREADY_OPEN';
  readonly kind = 'conflict';
}

export class CreditAccountClosedError extends DomainError {
  readonly code = 'CREDIT_ACCOUNT_CLOSED';
  readonly kind = 'conflict';
}
