import { DomainError } from '../common/errors/domain-error';

export class DepositOutOfRangeError extends DomainError {
  readonly code = 'DEPOSIT_OUT_OF_RANGE';
  readonly kind = 'validation';
}
