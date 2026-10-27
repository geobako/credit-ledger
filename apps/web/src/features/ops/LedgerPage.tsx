import { BookOpenCheck, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Mono, Skeleton, Tip } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { formatMoney, minor } from '@/lib/money';
import type { JournalEntry } from '@/lib/types';
import { cn, formatDateTime, humanize, shortId } from '@/lib/utils';
import { AccountFilter } from './AccountFilter';
import { useAccountFilter } from './useAccountFilter';
import { PageTitle } from './OpsConsole';
import { useLedgerEntries } from './queries';

export function LedgerPage() {
  const [accountId] = useAccountFilter();
  const { data, isPending, error, refetch, isFetching } = useLedgerEntries(accountId);
  return (
    <>
      <PageTitle
        title="Ledger explorer"
        description="Append-only double-entry journal. Every entry's debits equal its credits, enforced by the database."
        actions={
          <>
            <AccountFilter />
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void refetch()}
              aria-label="Refresh"
            >
              <RefreshCw className={cn(isFetching && 'animate-spin')} />
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Panel>
          <EmptyState icon={<BookOpenCheck />} title="No journal entries" />
        </Panel>
      ) : (
        <div className="space-y-3">
          {data.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
}

function EntryCard({ entry }: { entry: JournalEntry }) {
  const sum = (dir: 'DEBIT' | 'CREDIT') =>
    entry.postings.filter((p) => p.direction === dir).reduce((acc, p) => acc + minor(p.amount), 0n);
  const debits = sum('DEBIT');
  const credits = sum('CREDIT');
  const balanced = debits === credits;
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Badge tone="brand">{humanize(entry.type)}</Badge>
          <p className="truncate text-sm font-medium">{entry.description}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <Tip content={entry.reference ?? 'no reference'}>
            <Mono>{shortId(entry.id)}</Mono>
          </Tip>
          <span>{formatDateTime(entry.createdAt)}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-subtle">
          <tr>
            <th className="px-5 pb-1 pt-3 font-medium">Account</th>
            <th className="px-3 pb-1 pt-3 text-right font-medium">Debit</th>
            <th className="px-5 pb-1 pt-3 text-right font-medium">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entry.postings.map((p, i) => (
            <tr key={i}>
              <td className="px-5 py-1.5">
                <span className={cn(p.direction === 'CREDIT' && 'pl-6')}>
                  {humanize(p.accountKind)}
                </span>
                {p.ownerId && <Mono className="ml-2 text-[11px]">acct {shortId(p.ownerId)}</Mono>}
              </td>
              <td className="tabular px-3 py-1.5 text-right">
                {p.direction === 'DEBIT' ? formatMoney(p.amount) : ''}
              </td>
              <td className="tabular px-5 py-1.5 text-right">
                {p.direction === 'CREDIT' ? formatMoney(p.amount) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-surface-2/40 font-medium">
            <td className="px-5 py-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs',
                  balanced ? 'text-success' : 'text-danger',
                )}
              >
                {balanced ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {balanced ? 'Balanced' : 'Unbalanced'}
              </span>
            </td>
            <td className="tabular px-3 py-2 text-right">{formatMoney(debits)}</td>
            <td className="tabular px-5 py-2 text-right">{formatMoney(credits)}</td>
          </tr>
        </tfoot>
      </table>
    </Panel>
  );
}
