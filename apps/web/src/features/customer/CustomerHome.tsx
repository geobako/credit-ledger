import {
  Activity,
  ArrowDownLeft,
  CheckCircle2,
  CreditCard,
  DoorClosed,
  Landmark,
  Lock,
  Receipt,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton, Tip } from '@/components/ui/misc';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/features/auth/session';
import { errorMessage } from '@/lib/api';
import { formatMoney, minor } from '@/lib/money';
import {
  useAccounts,
  useCardState,
  useClosure,
  useIdempotencyKey,
  useOpenAccount,
} from '@/lib/queries';
import type { CreditAccount } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';
import { ActivityTimeline } from './ActivityTimeline';
import { CloseAccountDialog } from './CloseAccountDialog';
import { CreditRing } from './CreditRing';
import { PaymentDialog } from './PaymentDialog';
import { PaymentsList } from './PaymentsList';
import { SimulatePurchase } from './SimulatePurchase';
import { TransactionsList } from './TransactionsList';
import { usePayments } from './usePayments';
import { VirtualCard } from './VirtualCard';

/** Server-side limits (MIN/MAX_DEPOSIT_MINOR); the API enforces them, this just guides input. */
const DEPOSIT_LIMITS = { min: 5_000n, max: 1_000_000n };
const SANDBOX = true;

export function CustomerHome() {
  const { data: accounts, isPending, error, refetch } = useAccounts();
  if (isPending) return <HomeSkeleton />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const current = accounts.find((a) => a.status !== 'CLOSED') ?? accounts[0];
  if (!current) return <Welcome />;
  if (current.status === 'CLOSED') return <ClosedAccount account={current} />;
  return <AccountDashboard account={current} />;
}

function Greeting({ subtitle }: { subtitle: string }) {
  const { session } = useSession();
  const first = session!.user.name.split(' ')[0];
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hi {first} 👋</h1>
      <p className="mt-1 text-muted">{subtitle}</p>
    </div>
  );
}

function Welcome() {
  const open = useOpenAccount();
  const [key] = useIdempotencyKey();
  const steps = [
    { icon: Sparkles, title: 'Open your account', text: 'Takes a second. No credit check.' },
    {
      icon: Landmark,
      title: 'Deposit collateral',
      text: 'From $50. It becomes your credit limit.',
    },
    {
      icon: CreditCard,
      title: 'Spend with your card',
      text: 'Activated as soon as your deposit clears.',
    },
  ];
  return (
    <div className="mx-auto max-w-3xl py-6 text-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-brand/10 text-brand">
          <ShieldCheck className="size-7" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your secured card is one step away
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Put down a refundable deposit and get a card with a limit equal to it. Close any time and
          get your deposit back.
        </p>
        <div className="mt-10 grid gap-3 text-left sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <Panel key={title} className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
                  {i + 1}
                </span>
                <Icon className="size-4 text-brand" />
              </div>
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </Panel>
          ))}
        </div>
        <Button
          size="lg"
          className="mt-10"
          loading={open.isPending}
          onClick={async () => {
            try {
              await open.mutateAsync(key);
              toast.success('Account opened. Next: add collateral.');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          Open my account
        </Button>
      </motion.div>
    </div>
  );
}

function AccountDashboard({ account }: { account: CreditAccount }) {
  const { session } = useSession();
  const [dialog, setDialog] = useState<'deposit' | 'repayment' | 'close' | null>(null);
  const cardState = useCardState();
  const card = account.card;
  const active = account.status === 'ACTIVE';
  const owed = minor(account.outstandingBalance);

  async function toggleFreeze() {
    if (!card) return;
    const action = card.status === 'FROZEN' ? 'unfreeze' : 'freeze';
    try {
      await cardState.mutateAsync({ cardId: card.id, action });
      toast.success(action === 'freeze' ? 'Card frozen' : 'Card unfrozen');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <Greeting
        subtitle={
          active
            ? `You have ${formatMoney(account.availableCredit)} available to spend.`
            : 'Add collateral to activate your card.'
        }
      />

      {!active && <ActivationSteps account={account} onDeposit={() => setDialog('deposit')} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Panel className="@container p-5 sm:p-6">
            {/* Side by side only when the panel itself is wide enough, whatever the viewport. */}
            <div className="grid items-center gap-8 @3xl:grid-cols-[minmax(0,400px)_1fr]">
              <VirtualCard card={card} holder={session!.user.name} />
              {active ? (
                <CreditRing account={account} />
              ) : (
                <div className="text-sm text-muted">
                  Your card number is reserved. As soon as your collateral clears, it activates with
                  a credit limit equal to your deposit.
                </div>
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
              <Button onClick={() => setDialog('deposit')}>
                <ArrowDownLeft /> Add collateral
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDialog('repayment')}
                disabled={owed === 0n}
              >
                <Wallet /> Make a payment
              </Button>
              {card && (card.status === 'ACTIVE' || card.status === 'FROZEN') && (
                <Button variant="secondary" onClick={toggleFreeze} loading={cardState.isPending}>
                  {card.status === 'FROZEN' ? <Lock /> : <Snowflake />}
                  {card.status === 'FROZEN' ? 'Unfreeze card' : 'Freeze card'}
                </Button>
              )}
              <Button variant="ghost" className="ml-auto" onClick={() => setDialog('close')}>
                <DoorClosed /> Close account
              </Button>
            </div>
          </Panel>

          <Stats account={account} />

          <Panel>
            <Tabs defaultValue="transactions">
              <div className="flex items-center justify-between gap-3 px-5 pt-5">
                <h2 className="text-[15px] font-semibold tracking-tight">History</h2>
                <TabsList>
                  <TabsTrigger value="transactions">
                    <CreditCard /> Card
                  </TabsTrigger>
                  <TabsTrigger value="payments">
                    <Receipt /> Payments
                  </TabsTrigger>
                  <TabsTrigger value="activity">
                    <Activity /> Activity
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="px-5 pb-3">
                <TabsContent value="transactions">
                  <TransactionsList accountId={account.id} sandbox={SANDBOX} />
                </TabsContent>
                <TabsContent value="payments">
                  <PaymentsList accountId={account.id} sandbox={SANDBOX} />
                </TabsContent>
                <TabsContent value="activity">
                  <ActivityTimeline accountId={account.id} />
                </TabsContent>
              </div>
            </Tabs>
          </Panel>
        </div>

        <aside className="space-y-6">
          {SANDBOX && active && <SimulatePurchase account={account} />}
          <AccountFacts account={account} />
        </aside>
      </div>

      <PaymentDialog
        kind="deposit"
        account={account}
        open={dialog === 'deposit'}
        onOpenChange={(o) => setDialog(o ? 'deposit' : null)}
        limits={DEPOSIT_LIMITS}
      />
      <PaymentDialog
        kind="repayment"
        account={account}
        open={dialog === 'repayment'}
        onOpenChange={(o) => setDialog(o ? 'repayment' : null)}
        limits={{ min: 1n, max: owed > 0n ? owed : 1n }}
      />
      <CloseAccountDialog
        account={account}
        open={dialog === 'close'}
        onOpenChange={(o) => setDialog(o ? 'close' : null)}
      />
    </>
  );
}

function ActivationSteps({
  account,
  onDeposit,
}: {
  account: CreditAccount;
  onDeposit: () => void;
}) {
  const { items } = usePayments(account.id);
  const pendingDeposit = items.some((i) => i.kind === 'deposit' && i.value.status === 'PENDING');
  const steps = [
    { label: 'Account opened', done: true },
    { label: 'Collateral sent', done: pendingDeposit },
    { label: 'Funds confirmed', done: false },
    { label: 'Card active', done: false },
  ];
  return (
    <Panel className="mb-6 overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <ol className="flex flex-1 items-center gap-2">
          {steps.map((step, i) => (
            <li key={step.label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  step.done
                    ? 'bg-success text-white'
                    : 'bg-surface-2 text-muted ring-1 ring-border',
                )}
              >
                {step.done ? <CheckCircle2 className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn('hidden text-sm md:block', step.done ? 'font-medium' : 'text-muted')}
              >
                {step.label}
              </span>
              {i < steps.length - 1 && (
                <span className={cn('h-px flex-1', step.done ? 'bg-success/50' : 'bg-border')} />
              )}
            </li>
          ))}
        </ol>
        <Button onClick={onDeposit}>
          {pendingDeposit ? 'Add another deposit' : 'Deposit collateral'}
        </Button>
      </div>
      {pendingDeposit && (
        <p className="border-t border-border bg-warning/5 px-5 py-2.5 text-sm text-muted">
          Waiting for your bank transfer to clear. In the sandbox, confirm it from the Payments tab.
        </p>
      )}
    </Panel>
  );
}

function Stats({ account }: { account: CreditAccount }) {
  const refund = minor(account.refundDue);
  const items = [
    {
      label: 'Collateral held',
      value: formatMoney(account.collateral),
      hint: 'Refundable deposit we hold for you',
    },
    {
      label: 'Credit limit',
      value: formatMoney(account.creditLimit),
      hint: `${account.advanceRateBps / 100}% of your collateral`,
    },
    {
      label: 'Balance owed',
      value: formatMoney(account.outstandingBalance),
      hint: 'Settled purchases not yet repaid',
    },
    refund > 0n
      ? {
          label: 'Overpaid',
          value: formatMoney(account.refundDue),
          hint: 'Paid beyond your balance, returned at closure',
        }
      : {
          label: 'Pending holds',
          value: formatMoney(account.heldAmount),
          hint: 'Approved purchases awaiting settlement',
        },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map((item) => (
        <Tip key={item.label} content={item.hint}>
          <Panel className="cursor-default p-4">
            <p className="text-xs font-medium text-muted">{item.label}</p>
            <p className="tabular mt-1 text-xl font-semibold tracking-tight">{item.value}</p>
          </Panel>
        </Tip>
      ))}
    </div>
  );
}

function AccountFacts({ account }: { account: CreditAccount }) {
  const rows: [string, React.ReactNode][] = [
    ['Status', <StatusBadge key="s" status={account.status} />],
    ['Card', account.card ? <StatusBadge key="c" status={account.card.status} /> : '—'],
    ['Opened', formatDateTime(account.createdAt)],
    ['Activated', account.activatedAt ? formatDateTime(account.activatedAt) : '—'],
    ['Advance rate', `${account.advanceRateBps / 100}%`],
  ];
  return (
    <Panel>
      <PanelHeader icon={<ShieldCheck />} title="Account" description="How your card is secured" />
      <dl className="space-y-3 p-5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function ClosedAccount({ account }: { account: CreditAccount }) {
  const closure = useClosure(account.id, true);
  const open = useOpenAccount();
  const [key] = useIdempotencyKey();
  const c = closure.data;
  return (
    <div className="mx-auto max-w-xl py-6">
      <Greeting subtitle="Your account is closed." />
      <Panel className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <p className="font-semibold">Settled in full</p>
            <p className="text-sm text-muted">
              Closed {account.closedAt ? formatDateTime(account.closedAt) : ''}
            </p>
          </div>
        </div>
        {closure.isPending ? (
          <Skeleton className="h-28" />
        ) : c ? (
          <dl className="space-y-2.5 text-sm">
            {(
              [
                ['Balance at closure', c.debtAtClosure],
                ['Paid from overpayments', c.refundApplied],
                ['Paid from collateral', c.collateralApplied],
                ...(minor(c.writtenOff) > 0n ? [['Written off', c.writtenOff] as const] : []),
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-muted">{label}</dt>
                <dd className="tabular">{formatMoney(value)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-3 font-semibold">
              <dt>Returned to you</dt>
              <dd className="tabular">{formatMoney(c.payout)}</dd>
            </div>
          </dl>
        ) : null}
        <Button
          className="mt-6 w-full"
          loading={open.isPending}
          onClick={async () => {
            try {
              await open.mutateAsync(key);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          Open a new account
        </Button>
      </Panel>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
