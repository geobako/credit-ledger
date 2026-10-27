import { BookOpenCheck, Fingerprint, Users } from 'lucide-react';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, Mono, Skeleton, Tip } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { formatMoney, minor, ratio } from '@/lib/money';
import { useAccounts } from '@/lib/queries';
import { shortId, timeAgo } from '@/lib/utils';
import { PageTitle } from './OpsConsole';

export function AccountsPage() {
  const { data, isPending, error, refetch } = useAccounts();
  return (
    <>
      <PageTitle title="Credit accounts" description="Every secured account, newest first." />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2/50 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3">Account</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Collateral</th>
                  <th className="px-3 py-3 text-right">Limit</th>
                  <th className="px-3 py-3">Utilisation</th>
                  <th className="px-3 py-3 text-right">Available</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isPending &&
                  Array.from({ length: 4 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="px-5 py-3">
                        <Skeleton className="h-6" />
                      </td>
                    </tr>
                  ))}
                {data?.map((a) => {
                  const limit = minor(a.creditLimit);
                  const used = minor(a.outstandingBalance) + minor(a.heldAmount);
                  const pct = ratio(used, limit);
                  return (
                    <tr key={a.id} className="transition hover:bg-surface-2/40">
                      <td className="px-5 py-3">
                        <Mono className="text-fg">{shortId(a.id)}</Mono>
                        <p className="text-xs text-muted">
                          opened {timeAgo(a.createdAt)} · card ••{a.card?.last4}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="tabular px-3 py-3 text-right">{formatMoney(a.collateral)}</td>
                      <td className="tabular px-3 py-3 text-right">{formatMoney(a.creditLimit)}</td>
                      <td className="px-3 py-3">
                        <Tip
                          content={`${formatMoney(a.outstandingBalance)} owed · ${formatMoney(a.heldAmount)} held`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className="h-full rounded-full bg-brand"
                                style={{ width: `${pct * 100}%` }}
                              />
                            </div>
                            <span className="tabular text-xs text-muted">
                              {Math.round(pct * 100)}%
                            </span>
                          </div>
                        </Tip>
                      </td>
                      <td className="tabular px-3 py-3 text-right font-medium">
                        {formatMoney(a.availableCredit)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1 text-muted">
                          <Tip content="Ledger entries">
                            <Link
                              to={`/ops/ledger?account=${a.id}`}
                              className="rounded-md p-1.5 hover:bg-surface-2 hover:text-fg"
                            >
                              <BookOpenCheck className="size-4" />
                            </Link>
                          </Tip>
                          <Tip content="Audit trail">
                            <Link
                              to={`/ops/audit?account=${a.id}`}
                              className="rounded-md p-1.5 hover:bg-surface-2 hover:text-fg"
                            >
                              <Fingerprint className="size-4" />
                            </Link>
                          </Tip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data?.length === 0 && (
            <EmptyState
              icon={<Users />}
              title="No accounts yet"
              description="Sign in as a customer to open one."
            />
          )}
        </Panel>
      )}
    </>
  );
}
