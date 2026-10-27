import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  DoorClosed,
  Lock,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { formatMoney, type Money } from '@/lib/money';
import { useActivity } from '@/lib/queries';
import type { ActivityItem } from '@/lib/types';
import { cn, humanize, timeAgo } from '@/lib/utils';
import { ListSkeleton } from './TransactionsList';

type Describe = (d: Record<string, unknown>) => string;
const amount = (d: Record<string, unknown>, key = 'amount') =>
  formatMoney(d[key] as Money | undefined);

const EVENTS: Record<string, { icon: LucideIcon; tone: string; title: string; detail?: Describe }> =
  {
    CreditAccountOpened: {
      icon: Sparkles,
      tone: 'text-brand bg-brand/10',
      title: 'Account opened',
    },
    CollateralDepositRequested: {
      icon: ArrowDownLeft,
      tone: 'text-muted bg-surface-2',
      title: 'Collateral deposit started',
      detail: (d) => amount(d),
    },
    CollateralDepositConfirmed: {
      icon: CheckCircle2,
      tone: 'text-success bg-success/10',
      title: 'Collateral confirmed',
      detail: (d) => amount(d),
    },
    CollateralDepositFailed: {
      icon: XCircle,
      tone: 'text-danger bg-danger/10',
      title: 'Collateral deposit failed',
    },
    CollateralDepositRejected: {
      icon: XCircle,
      tone: 'text-danger bg-danger/10',
      title: 'Collateral deposit rejected',
    },
    CreditAccountActivated: {
      icon: CreditCard,
      tone: 'text-success bg-success/10',
      title: 'Card activated',
    },
    CreditLimitChanged: {
      icon: CircleDollarSign,
      tone: 'text-brand bg-brand/10',
      title: 'Credit limit updated',
      detail: (d) => `${amount(d, 'previous')} → ${amount(d, 'current')}`,
    },
    AuthorizationApproved: {
      icon: ShoppingBag,
      tone: 'text-info bg-info/10',
      title: 'Purchase approved',
      detail: (d) => `${amount(d)}${d.merchantName ? ` at ${String(d.merchantName)}` : ''}`,
    },
    AuthorizationDeclined: {
      icon: Ban,
      tone: 'text-danger bg-danger/10',
      title: 'Purchase declined',
      detail: (d) => `${amount(d)} · ${humanize(String(d.declineReason ?? ''))}`,
    },
    AuthorizationCaptured: {
      icon: CheckCircle2,
      tone: 'text-success bg-success/10',
      title: 'Purchase settled',
      detail: (d) => amount(d, 'captured'),
    },
    AuthorizationReversed: {
      icon: Undo2,
      tone: 'text-muted bg-surface-2',
      title: 'Hold released',
      detail: (d) => amount(d, 'released'),
    },
    AuthorizationExpired: {
      icon: Undo2,
      tone: 'text-muted bg-surface-2',
      title: 'Hold expired',
      detail: (d) => amount(d, 'released'),
    },
    CardFrozen: { icon: Snowflake, tone: 'text-info bg-info/10', title: 'Card frozen' },
    CardUnfrozen: { icon: Lock, tone: 'text-success bg-success/10', title: 'Card unfrozen' },
    RepaymentRequested: {
      icon: ArrowUpRight,
      tone: 'text-muted bg-surface-2',
      title: 'Payment started',
      detail: (d) => amount(d),
    },
    RepaymentSettled: {
      icon: CheckCircle2,
      tone: 'text-success bg-success/10',
      title: 'Payment received',
      detail: (d) => amount(d),
    },
    RepaymentFailed: { icon: XCircle, tone: 'text-danger bg-danger/10', title: 'Payment failed' },
    RepaymentRejected: {
      icon: XCircle,
      tone: 'text-danger bg-danger/10',
      title: 'Payment rejected',
    },
    CreditAccountClosed: {
      icon: DoorClosed,
      tone: 'text-fg bg-surface-2',
      title: 'Account closed',
      detail: (d) => `${amount(d, 'payout')} returned`,
    },
  };

const ACTORS: Record<string, string> = {
  user: 'by you',
  provider: 'via your bank',
  service: 'via the card network',
  system: 'by Acme Credit',
};

export function ActivityTimeline({ accountId }: { accountId: string }) {
  const { data, isPending, error, refetch } = useActivity(accountId);
  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.length === 0) return <EmptyState icon={<Activity />} title="Nothing here yet" />;
  return (
    <ol className="relative py-2">
      <div className="absolute bottom-4 left-[17px] top-4 w-px bg-border" />
      {data.map((item) => (
        <TimelineItem key={item.seq} item={item} />
      ))}
    </ol>
  );
}

function TimelineItem({ item }: { item: ActivityItem }) {
  const meta = EVENTS[item.action] ?? {
    icon: Activity,
    tone: 'text-muted bg-surface-2',
    title: humanize(item.action),
  };
  const Icon = meta.icon;
  let detail = '';
  try {
    detail = meta.detail?.(item.data) ?? '';
  } catch {
    /* tolerate unexpected payloads */
  }
  return (
    <li className="relative flex gap-3 py-2.5">
      <div
        className={cn(
          'relative z-10 grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-surface',
          meta.tone,
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{meta.title}</p>
          <time
            className="shrink-0 text-xs text-subtle"
            dateTime={item.occurredAt}
            title={item.occurredAt}
          >
            {timeAgo(item.occurredAt)}
          </time>
        </div>
        {detail && detail !== '—' && <p className="tabular text-xs text-muted">{detail}</p>}
        <p className="text-[11px] text-subtle">{ACTORS[item.actor.type] ?? item.actor.type}</p>
      </div>
    </li>
  );
}
