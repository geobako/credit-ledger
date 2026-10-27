import { chainHash, findChainBreak, GENESIS_HASH, SealedEntry } from './audit-chain';

function chain(n: number): SealedEntry[] {
  const entries: SealedEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const entry = {
      seq: BigInt(i * 10),
      occurredAt: new Date(1_800_000_000_000 + i),
      actorType: 'user',
      actorId: `u${i}`,
      action: 'AuthorizationApproved',
      entityType: 'authorization',
      entityId: `a${i}`,
      creditAccountId: 'acc',
      requestId: `r${i}`,
      data: { amount: { amount: String(i * 100), currency: 'USD' } },
    };
    const hash = chainHash(entry, BigInt(i), prev);
    entries.push({ ...entry, chainPosition: BigInt(i), prevHash: prev, hash });
    prev = hash;
  }
  return entries;
}

const start = { position: 0n, hash: GENESIS_HASH };

describe('audit hash chain', () => {
  it('verifies an untouched chain', () => {
    expect(findChainBreak(chain(5), start)).toBeNull();
  });

  it('detects an edited entry', () => {
    const entries = chain(5);
    entries[2] = { ...entries[2]!, data: { amount: { amount: '1', currency: 'USD' } } };
    expect(findChainBreak(entries, start)).toEqual({ position: 3n, reason: 'HASH_MISMATCH' });
  });

  it('detects a removed entry', () => {
    const entries = chain(5);
    entries.splice(1, 1);
    expect(findChainBreak(entries, start)).toEqual({ position: 2n, reason: 'GAP' });
  });

  it('detects a re-hashed forgery from the link to the next entry', () => {
    const entries = chain(5);
    const forged = { ...entries[2]!, actorId: 'attacker' };
    entries[2] = { ...forged, hash: chainHash(forged, 3n, forged.prevHash!) };
    expect(findChainBreak(entries, start)).toEqual({ position: 4n, reason: 'BROKEN_LINK' });
  });

  it('is insensitive to JSON key order in data', () => {
    const [entry] = chain(1);
    const reordered = { ...entry!, data: { amount: { currency: 'USD', amount: '100' } } };
    expect(chainHash(reordered, 1n, GENESIS_HASH)).toBe(entry!.hash);
  });
});
