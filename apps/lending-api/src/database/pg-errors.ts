/** SQLSTATEs the service reacts to. LGxxx are raised by the ledger triggers (0001_ledger_invariants.sql). */
export const PgErrorCode = {
  UniqueViolation: '23505',
  CheckViolation: '23514',
  ForeignKeyViolation: '23503',
  SerializationFailure: '40001',
  DeadlockDetected: '40P01',
  LedgerUnbalanced: 'LG001',
  LedgerImmutable: 'LG002',
  LedgerCurrencyMismatch: 'LG003',
  LedgerForeignTransaction: 'LG004',
} as const;

export interface PgError extends Error {
  code: string;
  constraint?: string;
}

/** Drizzle wraps driver errors; walk the cause chain to find the Postgres one. */
export function findPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error && typeof (current as Partial<PgError>).code === 'string') {
      return current as PgError;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

export function isPgError(error: unknown, code: string, constraint?: string): boolean {
  const pg = findPgError(error);
  return !!pg && pg.code === code && (constraint === undefined || pg.constraint === constraint);
}
