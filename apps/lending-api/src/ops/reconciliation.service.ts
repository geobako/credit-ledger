import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../database/database';
import { TransactionManager } from '../database/transaction-manager';
import { AuditService } from '../events/audit.service';
import { OutboxService } from '../events/outbox.service';
import { LedgerService } from '../ledger/ledger.service';
import { Metrics } from '../metrics/metrics';

export interface ReconciliationCheck {
  name: string;
  description: string;
  ok: boolean;
  discrepancies: Record<string, unknown>[];
}

export interface ReconciliationReport {
  ok: boolean;
  checkedAt: string;
  checks: ReconciliationCheck[];
}

const MAX_DISCREPANCIES = 20;
const OUTBOX_MAX_LAG_SECONDS = 300;

/**
 * Independent re-derivation of every number the service relies on, compared with what it
 * stores. All checks read one consistent snapshot (REPEATABLE READ, read-only), so concurrent
 * traffic can never produce a false alarm. Any failure is a bug or tampering: alert on it.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly tx: TransactionManager,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly metrics: Metrics,
  ) {}

  async run(): Promise<ReconciliationReport> {
    const checks = await this.tx.run((tx) => this.checks(tx), {
      isolationLevel: 'repeatable read',
      readOnly: true,
    });
    const failed = checks.filter((c) => !c.ok);
    this.metrics.reconciliationFailedChecks.set(failed.length);
    if (failed.length > 0) {
      this.logger.error(
        { failed: failed.map((c) => c.name) },
        'reconciliation found discrepancies',
      );
    }
    return { ok: failed.length === 0, checkedAt: new Date().toISOString(), checks };
  }

  private async checks(tx: Transaction): Promise<ReconciliationCheck[]> {
    const rows = async (query: ReturnType<typeof sql>) =>
      (await tx.execute<Record<string, unknown>>(query)).rows.slice(0, MAX_DISCREPANCIES);
    const check = (
      name: string,
      description: string,
      discrepancies: Record<string, unknown>[],
    ) => ({
      name,
      description,
      ok: discrepancies.length === 0,
      discrepancies,
    });

    const trial = await this.ledger.trialBalance(tx);
    const drift = await this.ledger.findBalanceDrift(tx);
    const chain = await this.audit.verify(tx);
    const backlog = await this.outbox.backlog();

    return [
      check(
        'ledger_trial_balance',
        'Sum of debit-normal balances equals sum of credit-normal balances',
        trial.balanced
          ? []
          : [
              {
                debitNormal: trial.debitNormal.toString(),
                creditNormal: trial.creditNormal.toString(),
              },
            ],
      ),
      check('ledger_balance_drift', 'Every cached account balance equals the sum of its postings', [
        ...drift.slice(0, MAX_DISCREPANCIES).map((d) => ({ ...d })),
      ]),
      check(
        'outstanding_matches_ledger',
        "Each account's outstanding balance equals its card receivable in the ledger",
        await rows(sql`
          SELECT ca.id AS credit_account_id, ca.outstanding_balance::text AS stored,
                 coalesce(la.balance, 0)::text AS ledger
            FROM credit_accounts ca
            LEFT JOIN ledger_accounts la ON la.kind = 'CARD_RECEIVABLE' AND la.owner_id = ca.id
           WHERE ca.outstanding_balance <> coalesce(la.balance, 0)`),
      ),
      check(
        'holds_match_authorizations',
        "Each account's held amount equals the sum of its open authorization holds",
        await rows(sql`
          SELECT ca.id AS credit_account_id, ca.held_amount::text AS stored, coalesce(h.total, 0)::text AS holds
            FROM credit_accounts ca
            LEFT JOIN (SELECT credit_account_id, sum(amount) AS total FROM authorizations
                        WHERE status = 'HELD' GROUP BY credit_account_id) h ON h.credit_account_id = ca.id
           WHERE ca.held_amount <> coalesce(h.total, 0)`),
      ),
      check(
        'limit_matches_collateral',
        'Each active account’s credit limit equals its confirmed collateral × advance rate',
        await rows(sql`
          SELECT ca.id AS credit_account_id, ca.credit_limit::text AS stored,
                 (coalesce(la.balance, 0) * ca.advance_rate_bps / 10000)::text AS expected
            FROM credit_accounts ca
            LEFT JOIN ledger_accounts la ON la.kind = 'COLLATERAL_HELD' AND la.owner_id = ca.id
           WHERE ca.status = 'ACTIVE'
             AND ca.credit_limit <> coalesce(la.balance, 0) * ca.advance_rate_bps / 10000`),
      ),
      check(
        'collateral_segregation',
        'Segregated collateral cash equals the total collateral owed to customers',
        await rows(sql`
          SELECT cash.currency, cash.balance::text AS collateral_cash, coalesce(held.total, 0)::text AS collateral_owed
            FROM ledger_accounts cash
            LEFT JOIN (SELECT currency, sum(balance) AS total FROM ledger_accounts
                        WHERE kind = 'COLLATERAL_HELD' GROUP BY currency) held ON held.currency = cash.currency
           WHERE cash.kind = 'COLLATERAL_CASH' AND cash.balance <> coalesce(held.total, 0)`),
      ),
      check(
        'audit_chain_intact',
        'The audit hash chain recomputes without a break',
        chain.ok ? [] : [{ brokenAt: chain.brokenAt, reason: chain.reason }],
      ),
      check(
        'outbox_flowing',
        `No domain event has waited more than ${OUTBOX_MAX_LAG_SECONDS}s to be published`,
        (backlog.oldestPendingSeconds ?? 0) > OUTBOX_MAX_LAG_SECONDS
          ? [{ pending: backlog.pending, oldestPendingSeconds: backlog.oldestPendingSeconds }]
          : [],
      ),
    ];
  }
}
