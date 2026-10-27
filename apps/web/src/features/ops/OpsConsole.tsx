import {
  BookOpenCheck,
  Fingerprint,
  FlaskConical,
  LayoutDashboard,
  Scale,
  Send,
  Users,
} from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router';
import { cn } from '@/lib/utils';
import { AccountsPage } from './AccountsPage';
import { AuditPage } from './AuditPage';
import { ConcurrencyLab } from './ConcurrencyLab';
import { LedgerPage } from './LedgerPage';
import { OutboxPage } from './OutboxPage';
import { OverviewPage } from './OverviewPage';
import { ReconciliationPage } from './ReconciliationPage';

const NAV = [
  { to: '/ops', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ops/accounts', label: 'Accounts', icon: Users },
  { to: '/ops/ledger', label: 'Ledger', icon: BookOpenCheck },
  { to: '/ops/reconciliation', label: 'Reconciliation', icon: Scale },
  { to: '/ops/audit', label: 'Audit trail', icon: Fingerprint },
  { to: '/ops/outbox', label: 'Outbox', icon: Send },
  { to: '/ops/lab', label: 'Concurrency lab', icon: FlaskConical },
];

export function OpsConsole() {
  return (
    <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-surface text-fg shadow-xs ring-1 ring-border'
                  : 'text-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <Icon className="size-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="reconciliation" element={<ReconciliationPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="outbox" element={<OutboxPage />} />
          <Route path="lab" element={<ConcurrencyLab />} />
        </Routes>
      </div>
    </div>
  );
}

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
