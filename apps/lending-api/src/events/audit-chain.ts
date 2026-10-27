import { createHash } from 'node:crypto';
import { canonicalJson } from '../idempotency/request-hash';

export const GENESIS_HASH = '0'.repeat(64);

/** The fields of an audit entry that its hash commits to. */
export interface ChainableEntry {
  seq: bigint;
  occurredAt: Date;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  creditAccountId: string | null;
  requestId: string | null;
  data: Record<string, unknown>;
}

export interface SealedEntry extends ChainableEntry {
  chainPosition: bigint | null;
  prevHash: string | null;
  hash: string | null;
}

/** hash_n = SHA-256(hash_{n-1} ‖ n ‖ canonical(entry_n)). Changing any entry breaks every later link. */
export function chainHash(entry: ChainableEntry, chainPosition: bigint, prevHash: string): string {
  const body = canonicalJson({
    seq: entry.seq.toString(),
    occurredAt: entry.occurredAt.toISOString(),
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    creditAccountId: entry.creditAccountId,
    requestId: entry.requestId,
    data: entry.data,
  });
  return createHash('sha256').update(`${prevHash}\n${chainPosition}\n${body}`).digest('hex');
}

export type ChainBreak = { position: bigint; reason: 'GAP' | 'BROKEN_LINK' | 'HASH_MISMATCH' };

/**
 * Checks a contiguous run of sealed entries (ordered by chain position), continuing from the
 * given previous hash and position. Returns the first break, or null.
 */
export function findChainBreak(
  entries: SealedEntry[],
  previous: { position: bigint; hash: string },
): ChainBreak | null {
  let { position, hash } = previous;
  for (const entry of entries) {
    const expectedPosition = position + 1n;
    if (entry.chainPosition !== expectedPosition)
      return { position: expectedPosition, reason: 'GAP' };
    if (entry.prevHash !== hash) return { position: expectedPosition, reason: 'BROKEN_LINK' };
    if (entry.hash !== chainHash(entry, expectedPosition, hash)) {
      return { position: expectedPosition, reason: 'HASH_MISMATCH' };
    }
    position = expectedPosition;
    hash = entry.hash;
  }
  return null;
}
