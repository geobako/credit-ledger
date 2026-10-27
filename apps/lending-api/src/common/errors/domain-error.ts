/**
 * What kind of failure a domain error is. The HTTP layer maps kinds to status codes;
 * the domain stays transport-agnostic.
 */
export type DomainErrorKind =
  | 'validation' // the request itself is malformed or out of bounds
  | 'not_found' // the resource does not exist (or is not visible to the caller)
  | 'forbidden' // the caller may not do this
  | 'conflict' // the resource is in a state that does not allow this
  | 'unprocessable' // well-formed but refused by a business rule
  | 'unauthenticated'
  | 'invariant'; // should be impossible: a bug, logged loudly

/** Base class for expected business failures, with a stable machine-readable code. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly kind: DomainErrorKind;

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly kind = 'not_found';
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly kind = 'forbidden';
}
