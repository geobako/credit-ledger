import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { RequestContext } from '../common/context/request-context';
import type { Database, Executor, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { AuditEntry, auditLog } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { chainHash, findChainBreak, GENESIS_HASH } from './audit-chain';

export interface AuditRecord {
  action: string;
  entityType: string;
  entityId: string;
  creditAccountId?: string | null;
  data?: Record<string, unknown>;
}

export interface ChainVerification {
  ok: boolean;
  sealedEntries: number;
  unsealedEntries: number;
  brokenAt?: string;
  reason?: string;
}

const SEAL_LOCK = 'acme-credit:audit-seal';

/**
 * Append-only, tamper-evident audit trail.
 *
 * Writing is cheap and contention-free: entries are inserted inside the business transaction
 * (so they exist if and only if the change committed). Sealing them into a hash chain is done
 * afterwards by a single sealer: putting the chain head inside every transaction would
 * serialise all writes in the system on one row.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tx: TransactionManager,
  ) {}

  async record(tx: Transaction, record: AuditRecord): Promise<void> {
    const actor = RequestContext.actor();
    await tx.insert(auditLog).values({
      occurredAt: new Date(),
      actorType: actor.type,
      actorId: actor.id,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      creditAccountId: record.creditAccountId ?? null,
      requestId: RequestContext.requestId() ?? null,
      // Normalised through JSON so what is hashed later is exactly what jsonb stores.
      data: JSON.parse(JSON.stringify(record.data ?? {})) as Record<string, unknown>,
    });
  }

  /** Links unsealed entries onto the chain, in insertion order. Safe to call concurrently. */
  seal(batchSize = 500): Promise<number> {
    return this.tx.run(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${SEAL_LOCK}))`);
      const [head] = await tx
        .select({ position: auditLog.chainPosition, hash: auditLog.hash })
        .from(auditLog)
        .where(isNotNull(auditLog.chainPosition))
        .orderBy(desc(auditLog.chainPosition))
        .limit(1);
      const pending = await tx
        .select()
        .from(auditLog)
        .where(isNull(auditLog.hash))
        .orderBy(asc(auditLog.seq))
        .limit(batchSize);

      let position = head?.position ?? 0n;
      let prevHash = head?.hash ?? GENESIS_HASH;
      for (const entry of pending) {
        position += 1n;
        const hash = chainHash(entry, position, prevHash);
        await tx
          .update(auditLog)
          .set({ chainPosition: position, prevHash, hash })
          .where(eq(auditLog.seq, entry.seq));
        prevHash = hash;
      }
      return pending.length;
    });
  }

  /** Recomputes the whole chain. Any edit, deletion or re-ordering is reported. */
  async verify(db: Executor = this.db, pageSize = 1000): Promise<ChainVerification> {
    let previous = { position: 0n, hash: GENESIS_HASH };
    let sealed = 0;
    for (;;) {
      const page = await db
        .select()
        .from(auditLog)
        .where(
          and(isNotNull(auditLog.chainPosition), gt(auditLog.chainPosition, previous.position)),
        )
        .orderBy(asc(auditLog.chainPosition))
        .limit(pageSize);
      if (page.length === 0) break;
      const broken = findChainBreak(page, previous);
      if (broken) {
        return {
          ok: false,
          sealedEntries: sealed,
          unsealedEntries: await this.countUnsealed(db),
          brokenAt: broken.position.toString(),
          reason: broken.reason,
        };
      }
      sealed += page.length;
      const last = page[page.length - 1]!;
      previous = { position: last.chainPosition!, hash: last.hash! };
    }
    return { ok: true, sealedEntries: sealed, unsealedEntries: await this.countUnsealed(db) };
  }

  async list(
    filter: { creditAccountId?: string; entityId?: string },
    limit = 100,
  ): Promise<AuditEntry[]> {
    const conditions = [
      filter.creditAccountId ? eq(auditLog.creditAccountId, filter.creditAccountId) : undefined,
      filter.entityId ? eq(auditLog.entityId, filter.entityId) : undefined,
    ].filter((c) => c !== undefined);
    return this.db
      .select()
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.seq))
      .limit(limit);
  }

  private async countUnsealed(db: Executor): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(isNull(auditLog.hash));
    return row?.n ?? 0;
  }
}

export function presentAudit(entry: AuditEntry) {
  return {
    seq: entry.seq.toString(),
    occurredAt: entry.occurredAt,
    actor: { type: entry.actorType, id: entry.actorId },
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    creditAccountId: entry.creditAccountId,
    requestId: entry.requestId,
    data: entry.data,
    chainPosition: entry.chainPosition?.toString() ?? null,
    hash: entry.hash,
  };
}
