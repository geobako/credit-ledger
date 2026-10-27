import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../database/database';
import { auditLog, creditAccounts, OutboxEvent, outboxEvents } from '../database/schema';
import { findPgError } from '../database/pg-errors';
import { TransactionManager } from '../database/transaction-manager';
import { AuditService } from '../events/audit.service';
import { DomainEvents } from '../events/domain-events';
import { EventPublisher, OutboxService } from '../events/outbox.service';
import { createTestApp, TestApp } from '../test/app';
import { createIsolatedDatabase } from '../test/database';
import { flows } from '../test/flows';
import { ReconciliationReport, ReconciliationService } from './reconciliation.service';

/**
 * Audit trail, outbox and reconciliation. Runs against its own database: it asserts facts about
 * the whole system and deliberately tampers with data.
 */
describe('audit, outbox & reconciliation', () => {
  let t: TestApp;
  let f: ReturnType<typeof flows>;
  let sharedDatabaseUrl: string | undefined;

  beforeAll(async () => {
    sharedDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = await createIsolatedDatabase();
    t = await createTestApp();
    f = flows(t);
  });
  afterAll(async () => {
    await t.close();
    process.env.DATABASE_URL = sharedDatabaseUrl;
  });

  const audit = () => t.app.get(AuditService);
  const reconcile = () => t.app.get(ReconciliationService).run();
  const failing = (report: ReconciliationReport) =>
    report.checks.filter((c) => !c.ok).map((c) => c.name);

  /** Simulates a privileged attacker or a botched manual fix: triggers bypassed. */
  const asSuperuser = <T>(work: (tx: Transaction) => Promise<T>) =>
    t.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      return work(tx);
    });

  describe('audit trail', () => {
    it('records every step of a customer journey with who did it and under which request', async () => {
      const a = await t.activeAccount('50000');
      await f.spend(a, '2500');

      const entries = await audit().list({ creditAccountId: a.accountId });
      const steps = entries.reverse().map((e) => [e.action, e.actorType]);
      expect(steps).toEqual([
        ['CreditAccountOpened', 'user'],
        ['CollateralDepositRequested', 'user'],
        ['CollateralDepositConfirmed', 'provider'],
        ['CreditLimitChanged', 'provider'],
        ['CreditAccountActivated', 'provider'],
        ['AuthorizationApproved', 'service'],
        ['AuthorizationCaptured', 'service'],
      ]);
      expect(entries.every((e) => e.requestId)).toBe(true);
    });

    it('stores the caller-supplied request id', async () => {
      const token = await t.newCustomer();
      const requestId = `req-${randomUUID()}`;
      const res = await t.http
        .post('/v1/credit-accounts')
        .set(f.auth(token))
        .set('Idempotency-Key', randomUUID())
        .set('X-Request-Id', requestId)
        .expect(201);
      expect(res.headers['x-request-id']).toBe(requestId);
      const [entry] = await audit().list({ creditAccountId: (res.body as { id: string }).id });
      expect(entry!.requestId).toBe(requestId);
    });

    it('seals entries into a hash chain that verifies, even with concurrent sealers and writers', async () => {
      await Promise.all([
        ...Array.from({ length: 5 }, () => audit().seal(7)),
        ...Array.from({ length: 3 }, () => t.activeAccount('10000')),
        ...Array.from({ length: 5 }, () => audit().seal(7)),
      ]);
      while ((await audit().seal()) > 0);
      expect(await audit().verify()).toMatchObject({ ok: true, unsealedEntries: 0 });
    });

    it('rejects edits and deletions of audit entries', async () => {
      await audit().seal();
      const [entry] = await t.db.select().from(auditLog).limit(1);
      const attempt = async (work: Promise<unknown>) => {
        try {
          await work;
        } catch (error) {
          return findPgError(error)?.code;
        }
        return 'accepted';
      };
      expect(
        await attempt(
          t.db
            .update(auditLog)
            .set({ data: { forged: true } })
            .where(eq(auditLog.seq, entry!.seq)),
        ),
      ).toBe('LG002');
      expect(await attempt(t.db.delete(auditLog).where(eq(auditLog.seq, entry!.seq)))).toBe(
        'LG002',
      );
    });

    it('detects tampering that bypasses the database guards', async () => {
      await audit().seal();
      const [victim] = await t.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'AuthorizationApproved'))
        .limit(1);
      const original = victim!.data;
      await asSuperuser((tx) =>
        tx
          .update(auditLog)
          .set({ data: { ...original, amount: { amount: '1', currency: 'USD' } } })
          .where(eq(auditLog.seq, victim!.seq)),
      );
      try {
        expect(await audit().verify()).toMatchObject({
          ok: false,
          brokenAt: victim!.chainPosition!.toString(),
          reason: 'HASH_MISMATCH',
        });
        expect(failing(await reconcile())).toEqual(['audit_chain_intact']);
      } finally {
        await asSuperuser((tx) =>
          tx.update(auditLog).set({ data: original }).where(eq(auditLog.seq, victim!.seq)),
        );
      }
      expect((await audit().verify()).ok).toBe(true);
    });
  });

  describe('transactional outbox', () => {
    const recorder = () => {
      const seen: OutboxEvent[] = [];
      return {
        seen,
        publish: (e: OutboxEvent) => (seen.push(e), Promise.resolve()),
      } satisfies EventPublisher & { seen: OutboxEvent[] };
    };
    const outboxWith = (publisher: EventPublisher) =>
      new OutboxService(t.db, publisher, t.app.get(TransactionManager));

    it('writes events only when the transaction commits', async () => {
      const entityId = randomUUID();
      await expect(
        t.app.get(TransactionManager).run(async (tx) => {
          await t.app
            .get(DomainEvents)
            .emit(tx, { type: 'Test', entityType: 'test', entityId, data: {} });
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      const rows = await t.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, entityId));
      expect(rows).toHaveLength(0);
    });

    it('publishes each event in order, and retries failures with back-off', async () => {
      const a = await t.activeAccount('20000');
      await f.spend(a, '500');

      const broken = outboxWith({ publish: () => Promise.reject(new Error('broker down')) });
      const firstAttempt = await broken.relay(1000);
      expect(firstAttempt.published).toBe(0);
      const [failed] = await t.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, a.accountId))
        .limit(1);
      expect(failed).toMatchObject({ attempts: 1, lastError: 'broker down', publishedAt: null });
      expect(failed!.availableAt.getTime()).toBeGreaterThan(Date.now());

      // Back-off elapses; the broker is healthy again.
      await t.db.execute(
        sql`UPDATE outbox_events SET available_at = now() WHERE published_at IS NULL`,
      );
      const healthy = recorder();
      while ((await outboxWith(healthy).relay(1000)).published > 0);

      const forAccount = healthy.seen.filter((e) => e.payload.creditAccountId === a.accountId);
      expect(forAccount.map((e) => e.eventType)).toEqual([
        'CreditAccountOpened',
        'CollateralDepositRequested',
        'CollateralDepositConfirmed',
        'CreditLimitChanged',
        'CreditAccountActivated',
        'AuthorizationApproved',
        'AuthorizationCaptured',
      ]);
      expect(new Set(healthy.seen.map((e) => e.id)).size).toBe(healthy.seen.length);
      expect((await t.app.get(OutboxService).backlog()).pending).toBe(0);
    });
  });

  describe('reconciliation', () => {
    it('passes every check after real activity', async () => {
      const a = await t.activeAccount('50000');
      await f.spend(a, '9000');
      await f.spend(a, '1000', false);
      await f.repay(a, '4000');
      const b = await t.activeAccount('30000');
      await f.spend(b, '5000');
      await f.close(b).expect(200);
      await audit().seal();

      const report = await reconcile();
      expect(failing(report)).toEqual([]);
      expect(report.checks.map((c) => c.name)).toEqual([
        'ledger_trial_balance',
        'ledger_balance_drift',
        'outstanding_matches_ledger',
        'holds_match_authorizations',
        'limit_matches_collateral',
        'collateral_segregation',
        'audit_chain_intact',
        'outbox_flowing',
      ]);
    });

    it('pinpoints an account whose stored balance disagrees with the ledger', async () => {
      const a = await t.activeAccount('50000');
      await f.spend(a, '3000');
      await asSuperuser((tx) =>
        tx
          .update(creditAccounts)
          .set({ outstandingBalance: 0n })
          .where(eq(creditAccounts.id, a.accountId)),
      );
      try {
        const report = await reconcile();
        expect(failing(report)).toEqual(['outstanding_matches_ledger']);
        expect(report.checks.find((c) => !c.ok)!.discrepancies).toEqual([
          { credit_account_id: a.accountId, stored: '0', ledger: '3000' },
        ]);
      } finally {
        await asSuperuser((tx) =>
          tx
            .update(creditAccounts)
            .set({ outstandingBalance: 3000n })
            .where(eq(creditAccounts.id, a.accountId)),
        );
      }
    });

    it('catches a forged ledger balance from two independent angles', async () => {
      const cash = await t.db.execute<{ id: string; balance: string }>(
        sql`SELECT id, balance::text FROM ledger_accounts WHERE kind = 'COLLATERAL_CASH'`,
      );
      const { id, balance } = cash.rows[0]!;
      await asSuperuser((tx) =>
        tx.execute(sql`UPDATE ledger_accounts SET balance = balance + 100000 WHERE id = ${id}`),
      );
      try {
        expect(failing(await reconcile())).toEqual(
          expect.arrayContaining([
            'ledger_trial_balance',
            'ledger_balance_drift',
            'collateral_segregation',
          ]),
        );
      } finally {
        await asSuperuser((tx) =>
          tx.execute(sql`UPDATE ledger_accounts SET balance = ${balance}::bigint WHERE id = ${id}`),
        );
      }
      expect(failing(await reconcile())).toEqual([]);
    });
  });

  describe('HTTP surface', () => {
    it('restricts operations endpoints to ops staff', async () => {
      const customer = await t.newCustomer();
      const ops = await t.login('ops@acme.test');
      await t.http.get('/v1/ops/reconciliation').set(f.auth(customer)).expect(403);
      const report = await t.http.get('/v1/ops/reconciliation').set(f.auth(ops)).expect(200);
      expect(report.body).toMatchObject({ ok: true });
      await t.http.get('/v1/ops/audit/verify').set(f.auth(ops)).expect(200);
      await t.http.get('/v1/ops/overview').set(f.auth(ops)).expect(200);
    });

    it('shows a customer their own activity timeline, without chain internals', async () => {
      const a = await t.activeAccount('15000');
      const res = await t.http
        .get(`/v1/credit-accounts/${a.accountId}/activity`)
        .set(f.auth(a.token))
        .expect(200);
      const timeline = res.body as Record<string, unknown>[];
      expect(timeline.map((e) => e.action)).toContain('CreditAccountActivated');
      expect(timeline[0]).not.toHaveProperty('hash');
      expect(timeline[0]).not.toHaveProperty('requestId');

      const stranger = await t.newCustomer();
      await t.http
        .get(`/v1/credit-accounts/${a.accountId}/activity`)
        .set(f.auth(stranger))
        .expect(404);
    });

    it('lists journal entries with balanced postings for the ledger explorer', async () => {
      const a = await t.activeAccount('25000');
      await f.spend(a, '700');
      const ops = await t.login('ops@acme.test');
      const res = await t.http
        .get(`/v1/ops/ledger/entries?creditAccountId=${a.accountId}`)
        .set(f.auth(ops))
        .expect(200);
      const entries = res.body as {
        type: string;
        postings: { direction: string; amount: { amount: string } }[];
      }[];
      expect(entries.map((e) => e.type)).toEqual(['PURCHASE_CAPTURED', 'COLLATERAL_CONFIRMED']);
      for (const entry of entries) {
        const sum = (dir: string) =>
          entry.postings
            .filter((p) => p.direction === dir)
            .reduce((s, p) => s + BigInt(p.amount.amount), 0n);
        expect(sum('DEBIT')).toBe(sum('CREDIT'));
      }
    });

    it('exposes Prometheus metrics with bounded labels', async () => {
      const a = await t.activeAccount('10000');
      await f.spend(a, '100');
      await t.http.get(`/v1/credit-accounts/${a.accountId}`).set(f.auth(a.token)).expect(200);
      const res = await t.http.get('/metrics').expect(200);
      expect(res.text).toMatch(
        /card_authorization_decisions_total\{outcome="approved",reason="none"\} \d+/,
      );
      expect(res.text).toContain('route="/v1/credit-accounts/:id"');
      expect(res.text).not.toContain(a.accountId);
    });
  });
});
