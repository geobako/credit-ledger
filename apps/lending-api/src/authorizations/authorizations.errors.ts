import { DomainError } from '../common/errors/domain-error';

export class AuthorizationNotFoundError extends DomainError {
  readonly code = 'AUTHORIZATION_NOT_FOUND';
  readonly kind = 'not_found';
}

export class AuthorizationNotOpenError extends DomainError {
  readonly code = 'AUTHORIZATION_NOT_OPEN';
  readonly kind = 'conflict';
}

export class CaptureExceedsAuthorizationError extends DomainError {
  readonly code = 'CAPTURE_EXCEEDS_AUTHORIZATION';
  readonly kind = 'unprocessable';
}
