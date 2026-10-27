import { CheckCircle2, Play, Scale, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { PageTitle } from './OpsConsole';
import { useReconciliation } from './queries';

export function ReconciliationPage() {
  const { data, isPending, error, refetch, isFetching } = useReconciliation();
  return (
    <>
      <PageTitle
        title="Reconciliation"
        description="Re-derives every stored number from first principles in one consistent snapshot. Also runs on a schedule."
        actions={
          <Button onClick={() => void refetch()} loading={isFetching}>
            <Play /> Run now
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="space-y-4">
          <motion.div
            key={data.checkedAt}
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <Panel
              className={cn(
                'flex items-center gap-4 p-5',
                data.ok ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5',
              )}
            >
              <div
                className={cn(
                  'grid size-12 place-items-center rounded-full',
                  data.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
                )}
              >
                {data.ok ? <Scale className="size-6" /> : <XCircle className="size-6" />}
              </div>
              <div>
                <p className="text-lg font-semibold">
                  {data.ok ? 'Books reconcile' : 'Discrepancies found'}
                </p>
                <p className="text-sm text-muted">
                  {data.checks.filter((c) => c.ok).length} of {data.checks.length} checks passed ·{' '}
                  {formatDateTime(data.checkedAt)}
                </p>
              </div>
            </Panel>
          </motion.div>
          <Panel className="divide-y divide-border">
            {data.checks.map((check) => (
              <div key={check.name} className="flex gap-3 p-4">
                {check.ok ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{humanize(check.name)}</p>
                  <p className="text-sm text-muted">{check.description}</p>
                  {check.discrepancies.length > 0 && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
                      {JSON.stringify(check.discrepancies, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </>
  );
}
