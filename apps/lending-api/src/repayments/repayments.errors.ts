import { DomainError } from '../common/errors/domain-error';

export class NothingToRepayError extends DomainError {
  readonly code = 'NOTHING_TO_REPAY';
  readonly kind = 'unprocessable';
}

export class RepaymentExceedsBalanceError extends DomainError {
  readonly code = 'REPAYMENT_EXCEEDS_BALANCE';
  readonly kind = 'unprocessable';
}
