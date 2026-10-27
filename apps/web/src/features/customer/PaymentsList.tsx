import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Mono } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatMoney, minor } from '@/lib/money';
import { useSettlePayment } from '@/lib/queries';
import { type PaymentItem as Item, usePayments } from './usePayments';
import { formatDateTime, humanize } from '@/lib/utils';
import { ListSkeleton } from './TransactionsList';

export function PaymentsList({ accountId, sandbox }: { accountId: string; sandbox: boolean }) {
  const { items, isPending, error, refetch } = usePayments(accountId);
  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title="No payments yet"
        description="Collateral deposits and repayments appear here."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.value.id} className="flex items-center gap-3 py-3">
          <PaymentRow item={item} sandbox={sandbox} />
        </li>
      ))}
    </ul>
  );
}

function PaymentRow({ item, sandbox }: { item: Item; sandbox: boolean }) {
  const settle = useSettlePayment();
  const { value } = item;
  const isDeposit = item.kind === 'deposit';
  const excess = item.kind === 'repayment' ? minor(item.value.excessAmount) : 0n;

  async function simulate(outcome: 'succeeded' | 'failed') {
    try {
      await settle.mutateAsync({ reference: value.providerReference, outcome });
      toast.success(outcome === 'succeeded' ? 'Payment settled' : 'Payment marked as failed');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div
        className={
          'grid size-9 shrink-0 place-items-center rounded-full ' +
          (isDeposit ? 'bg-brand/10 text-brand' : 'bg-success/10 text-success')
        }
      >
        {isDeposit ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{isDeposit ? 'Collateral deposit' : 'Repayment'}</p>
        <p className="truncate text-xs text-muted">
          {formatDateTime(value.createdAt)} ·{' '}
          <Mono className="text-[11px]">{value.providerReference}</Mono>
          {value.failureReason && <> · {humanize(value.failureReason)}</>}
          {excess > 0n && <> · {formatMoney(excess)} over, refunded at closure</>}
        </p>
      </div>
      {sandbox && value.status === 'PENDING' && (
        <div className="hidden gap-1 sm:flex">
          <Button
            size="sm"
            variant="subtle"
            onClick={() => simulate('succeeded')}
            disabled={settle.isPending}
          >
            Bank confirms
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => simulate('failed')}
            disabled={settle.isPending}
          >
            Fail
          </Button>
        </div>
      )}
      <div className="flex flex-col items-end gap-1">
        <p className="tabular text-sm font-semibold">{formatMoney(value.amount)}</p>
        <StatusBadge status={value.status} />
      </div>
    </>
  );
}
