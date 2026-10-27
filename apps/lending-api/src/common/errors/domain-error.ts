/**
 * Base class for expected business failures. Carries a stable machine-readable code;
 * the HTTP layer maps codes to status codes, the domain stays transport-agnostic.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}
