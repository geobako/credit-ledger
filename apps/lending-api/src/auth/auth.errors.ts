import { DomainError } from '../common/errors/domain-error';

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly kind = 'unauthenticated';
}

export class EmailTakenError extends DomainError {
  readonly code = 'EMAIL_TAKEN';
  readonly kind = 'conflict';
}

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly kind = 'unauthenticated';
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'INVALID_REFRESH_TOKEN';
  readonly kind = 'unauthenticated';
}

/** The token was rotated a moment ago by a concurrent request; retry with the new cookie. */
export class RefreshTokenSupersededError extends DomainError {
  readonly code = 'REFRESH_TOKEN_SUPERSEDED';
  readonly kind = 'unauthenticated';
}

export class MissingCsrfHeaderError extends DomainError {
  readonly code = 'CSRF_HEADER_REQUIRED';
  readonly kind = 'forbidden';
}
