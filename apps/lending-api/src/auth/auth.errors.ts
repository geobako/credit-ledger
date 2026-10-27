import { DomainError } from '../common/errors/domain-error';

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly kind = 'unauthenticated';
}

export class EmailTakenError extends DomainError {
  readonly code = 'EMAIL_TAKEN';
  readonly kind = 'conflict';
}
