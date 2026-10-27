import { DomainError } from '../common/errors/domain-error';

export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly kind = 'unprocessable';
}
