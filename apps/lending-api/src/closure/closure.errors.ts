import { DomainError } from '../common/errors/domain-error';

export class OpenAuthorizationsError extends DomainError {
  readonly code = 'ACCOUNT_HAS_OPEN_AUTHORIZATIONS';
  readonly kind = 'conflict';
}

export class InsufficientCollateralToCloseError extends DomainError {
  readonly code = 'INSUFFICIENT_COLLATERAL_TO_CLOSE';
  readonly kind = 'unprocessable';
}

export class LedgerNotSettledError extends DomainError {
  readonly code = 'CLOSURE_LEDGER_NOT_SETTLED';
  readonly kind = 'invariant';
}
