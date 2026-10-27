import { Banknote, CircleDollarSign, Clock, Hourglass, Landmark, Users } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { formatMoney } from '@/lib/money';
import { humanize } from '@/lib/utils';
import { PageTitle } from './OpsConsole';
import { useOverview } from './queries';

const SYSTEM_ACCOUNTS: Record<string, string> = {
  COLLATERAL_CASH: 'Segregated cash backing customer collateral',
  OPERATING_CASH: 'Company cash used to pay merchants',
  MERCHANT_PAYABLE: 'Owed to merchants for captured purchases',
  FEE_INCOME: 'Fees earned',
  CREDIT_LOSS: 'Balances written off',
};

export function OverviewPage() {
  const { data, isPending, error, refetch } = useOverview();
  return (
    <>
      <PageTitle
        title="Portfolio overview"
        description="Live totals across all secured accounts. Refreshes every 5 seconds."
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={<Users />}
              label="Active accounts"
              value={String(data.accountsByStatus.ACTIVE ?? 0)}
              sub={`${data.accountsByStatus.PENDING_COLLATERAL ?? 0} awaiting collateral · ${data.accountsByStatus.CLOSED ?? 0} closed`}
            />
            <Kpi
              icon={<Landmark />}
              label="Credit extended"
              value={formatMoney(data.active.creditLimit)}
              sub="Sum of active limits"
            />
            <Kpi
              icon={<CircleDollarSign />}
              label="Outstanding"
              value={formatMoney(data.active.outstanding)}
              sub="Owed by customers"
            />
            <Kpi
              icon={<Hourglass />}
              label="Pending holds"
              value={formatMoney(data.active.held)}
              sub="Authorized, not yet captured"
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Panel>
              <PanelHeader
                icon={<Banknote />}
                title="System ledger accounts"
                description="Company-side balances in the double-entry ledger"
                actions={
                  <Link to="/ops/ledger" className="text-sm font-medium text-brand hover:underline">
                    Explore ledger
                  </Link>
                }
              />
              <ul className="divide-y divide-border px-5 pb-2 pt-3">
                {Object.entries(data.systemAccounts)
                  .sort()
                  .map(([kind, money]) => (
                    <li key={kind} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm font-medium">{humanize(kind)}</p>
                        <p className="text-xs text-muted">{SYSTEM_ACCOUNTS[kind] ?? kind}</p>
                      </div>
                      <p className="tabular text-sm font-semibold">{formatMoney(money)}</p>
                    </li>
                  ))}
                {Object.keys(data.systemAccounts).length === 0 && (
                  <li className="py-6 text-center text-sm text-muted">No ledger activity yet</li>
                )}
              </ul>
            </Panel>
            <Panel>
              <PanelHeader
                icon={<Clock />}
                title="Event outbox"
                description="Domain events awaiting publication"
              />
              <div className="p-5">
                <p className="tabular text-4xl font-semibold tracking-tight">
                  {data.outbox.pending}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {data.outbox.pending === 0
                    ? 'All events published'
                    : `Oldest waiting ${Math.round(data.outbox.oldestPendingSeconds ?? 0)}s`}
                </p>
                <Link
                  to="/ops/outbox"
                  className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
                >
                  View events
                </Link>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className="text-subtle [&_svg]:size-4">{icon}</span>
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </Panel>
  );
}
