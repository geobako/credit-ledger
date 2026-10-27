import { CheckCircle2, FlaskConical, Play, RotateCcw, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, Mono } from '@/components/ui/misc';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { MoneyInput } from '@/components/MoneyInput';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, minor, parseAmount } from '@/lib/money';
import { simulatePurchase, useAccounts } from '@/lib/queries';
import type { CreditAccount } from '@/lib/types';
import { cn, humanize, shortId } from '@/lib/utils';
import { PageTitle } from './OpsConsole';

type Cell =
  | { state: 'pending' }
  | { state: 'approved'; authorizationId: string; ms: number }
  | { state: 'declined'; reason: string; ms: number }
  | { state: 'error'; reason: string; ms: number };

interface Run {
  account: CreditAccount;
  amount: bigint;
  availableBefore: bigint;
  cells: Cell[];
  availableAfter?: bigint;
  elapsedMs?: number;
}

/**
 * Fires N purchases at one card at the same moment. Row locking on the credit account must
 * approve exactly floor(available / amount) of them, never one more, whatever the interleaving.
 */
export function ConcurrencyLab() {
  const { data: accounts } = useAccounts();
  const queryClient = useQueryClient();
  const eligible = (accounts ?? []).filter(
    (a) => a.status === 'ACTIVE' && a.card?.status === 'ACTIVE',
  );
  const [accountId, setAccountId] = useState('');
  const [count, setCount] = useState('40');
  const [value, setValue] = useState('25');
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const account = eligible.find((a) => a.id === accountId) ?? eligible[0];
  const amount = parseAmount(value);
  const n = Number.parseInt(count, 10);
  const valid = !!account && !!amount && amount > 0n && n >= 2 && n <= 200;

  async function start() {
    if (!valid || !account || !amount) return;
    setRunning(true);
    try {
      await runExperiment(account.id, amount, n, setRun);
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  async function releaseHolds() {
    if (!run) return;
    setReleasing(true);
    const ids = run.cells.flatMap((c) => (c.state === 'approved' ? [c.authorizationId] : []));
    const results = await Promise.allSettled(
      ids.map((id) => api(`/v1/sandbox/authorizations/${id}/reverse`, { method: 'POST' })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setReleasing(false);
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    if (failed)
      toast.warning(
        `${ids.length - failed} holds released, ${failed} could not be (already settled?)`,
      );
    else toast.success(`Released ${ids.length} holds`);
    setRun(null);
  }

  return (
    <>
      <PageTitle
        title="Concurrency lab"
        description="Race many purchases against one card's last dollars and check the limit is never exceeded."
      />
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel className="h-fit">
          <PanelHeader icon={<FlaskConical />} title="Experiment" />
          {eligible.length === 0 ? (
            <EmptyState
              icon={<FlaskConical />}
              title="No active cards"
              description="Activate a customer's card first (deposit + confirm collateral)."
            />
          ) : (
            <div className="space-y-4 p-5">
              <Field
                label="Card"
                htmlFor="lab-account"
                hint={account ? `${formatMoney(account.availableCredit)} available` : undefined}
              >
                <select
                  id="lab-account"
                  value={account?.id ?? ''}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-xs focus:border-ring focus:outline-none"
                >
                  {eligible.map((a) => (
                    <option key={a.id} value={a.id}>
                      ••{a.card?.last4} · acct {shortId(a.id)} · {formatMoney(a.availableCredit)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Simultaneous purchases" htmlFor="lab-count" hint="2 to 200">
                <Input
                  id="lab-count"
                  type="number"
                  min={2}
                  max={200}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </Field>
              <Field label="Amount each" htmlFor="lab-amount">
                <MoneyInput id="lab-amount" value={value} onChange={setValue} />
              </Field>
              {account && amount && amount > 0n && n > 0 && (
                <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
                  {n} × {formatMoney(amount)} ={' '}
                  <span className="font-medium text-fg">{formatMoney(amount * BigInt(n))}</span>{' '}
                  requested against {formatMoney(account.availableCredit)}. Expect exactly{' '}
                  <span className="font-medium text-fg">
                    {expectedApprovals(minor(account.availableCredit), amount, n)}
                  </span>{' '}
                  approvals.
                </p>
              )}
              <Button
                className="w-full"
                onClick={start}
                loading={running}
                disabled={!valid || running || releasing}
              >
                <Play /> Fire all at once
              </Button>
              <p className="text-[11px] leading-relaxed text-subtle">
                Browsers open ~6 connections per host, so requests overlap in waves. The k6 and
                integration tests push true 100-way concurrency at the API.
              </p>
            </div>
          )}
        </Panel>
        {run ? (
          <Results run={run} onRelease={releaseHolds} releasing={releasing} running={running} />
        ) : (
          <Panel className="grid place-items-center">
            <EmptyState
              icon={<Play />}
              title="Run an experiment"
              description="Each square is one purchase. Watch them resolve in parallel."
            />
          </Panel>
        )}
      </div>
    </>
  );
}

/** Fires every purchase at once, streaming each outcome into the grid as it lands. */
async function runExperiment(
  accountId: string,
  amount: bigint,
  n: number,
  setRun: React.Dispatch<React.SetStateAction<Run | null>>,
) {
  const fresh = await api<CreditAccount>(`/v1/credit-accounts/${accountId}`);
  const cells: Cell[] = Array.from({ length: n }, () => ({ state: 'pending' }));
  setRun({
    account: fresh,
    amount,
    availableBefore: minor(fresh.availableCredit),
    cells: [...cells],
  });
  const t0 = performance.now();
  await Promise.all(
    cells.map(async (_, i) => {
      const t = performance.now();
      try {
        const { decision } = await simulatePurchase({
          cardId: fresh.card!.id,
          amount,
          merchantName: `Lab run #${i + 1}`,
        });
        const ms = Math.round(performance.now() - t);
        cells[i] = decision.approved
          ? { state: 'approved', authorizationId: decision.authorizationId!, ms }
          : { state: 'declined', reason: decision.declineReason ?? 'DECLINED', ms };
      } catch (err) {
        cells[i] = {
          state: 'error',
          reason: errorMessage(err),
          ms: Math.round(performance.now() - t),
        };
      }
      setRun((r) => (r ? { ...r, cells: [...cells] } : r));
    }),
  );
  const elapsedMs = Math.round(performance.now() - t0);
  const after = await api<CreditAccount>(`/v1/credit-accounts/${accountId}`);
  setRun(
    (r) =>
      r && { ...r, cells: [...cells], availableAfter: minor(after.availableCredit), elapsedMs },
  );
}

const expectedApprovals = (available: bigint, amount: bigint, n: number) => {
  const fit = available / amount;
  return fit < BigInt(n) ? Number(fit) : n;
};

function Results({
  run,
  onRelease,
  releasing,
  running,
}: {
  run: Run;
  onRelease: () => void;
  releasing: boolean;
  running: boolean;
}) {
  const approved = run.cells.filter((c) => c.state === 'approved').length;
  const declined = run.cells.filter((c) => c.state === 'declined').length;
  const errors = run.cells.filter((c) => c.state === 'error').length;
  const done = run.availableAfter !== undefined;
  const expected = expectedApprovals(run.availableBefore, run.amount, run.cells.length);
  const approvedTotal = run.amount * BigInt(approved);
  const consistent = done && run.availableAfter === run.availableBefore - approvedTotal;
  const pass =
    done &&
    approved === expected &&
    errors === 0 &&
    consistent &&
    approvedTotal <= run.availableBefore;

  return (
    <Panel>
      <PanelHeader
        title="Results"
        description={
          done ? `${run.cells.length} requests resolved in ${run.elapsedMs} ms` : 'Resolving…'
        }
        actions={
          approved > 0 && done ? (
            <Button variant="secondary" size="sm" onClick={onRelease} loading={releasing}>
              <RotateCcw /> Release holds
            </Button>
          ) : null
        }
      />
      <div className="p-5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(28px,1fr))] gap-1.5">
          {run.cells.map((cell, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.004 }}
              title={
                cell.state === 'pending'
                  ? 'pending'
                  : cell.state === 'approved'
                    ? `approved in ${cell.ms} ms`
                    : `${humanize(cell.reason)} (${cell.ms} ms)`
              }
              className={cn(
                'aspect-square rounded-md transition-colors duration-300',
                cell.state === 'pending' && 'animate-pulse bg-surface-2 ring-1 ring-border',
                cell.state === 'approved' && 'bg-success shadow-sm shadow-success/30',
                cell.state === 'declined' && 'bg-danger/70',
                cell.state === 'error' && 'bg-warning',
              )}
            />
          ))}
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Approved" value={String(approved)} tone="text-success" />
          <Stat label="Declined" value={String(declined)} tone="text-danger" />
          <Stat label="Approved total" value={formatMoney(approvedTotal)} />
          <Stat label="Available before" value={formatMoney(run.availableBefore)} />
        </dl>

        {done && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'mt-5 rounded-xl border p-4',
              pass ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5',
            )}
          >
            <div className="flex items-center gap-2 font-semibold">
              {pass ? (
                <CheckCircle2 className="size-5 text-success" />
              ) : (
                <XCircle className="size-5 text-danger" />
              )}
              {pass ? 'Invariant held: no overspend, no lost updates' : 'Unexpected result'}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              <Check ok={approved === expected}>
                Approved {approved}, expected exactly {expected} (⌊
                {formatMoney(run.availableBefore)} ÷ {formatMoney(run.amount)}⌋)
              </Check>
              <Check ok={approvedTotal <= run.availableBefore}>
                Approved total {formatMoney(approvedTotal)} ≤ available{' '}
                {formatMoney(run.availableBefore)}
              </Check>
              <Check ok={consistent}>
                Available after = {formatMoney(run.availableAfter ?? 0n)} = before − approved
              </Check>
              {errors > 0 && <Check ok={false}>{errors} requests errored (see tooltips)</Check>}
            </ul>
            <p className="mt-3 text-xs text-subtle">
              Declines read <Mono>{humanize('INSUFFICIENT_CREDIT')}</Mono>: each purchase locked the
              account row, saw the holds before it, and stopped at the limit.
            </p>
          </motion.div>
        )}
        {running && !done && <p className="mt-4 text-sm text-muted">Waiting for responses…</p>}
      </div>
    </Panel>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('tabular mt-0.5 text-lg font-semibold', tone)}>{value}</dd>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
      )}
      <span>{children}</span>
    </li>
  );
}
