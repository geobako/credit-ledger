import { CreditCard, ShoppingBag } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton, Tip } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useAuthorizationAction, useAuthorizations } from '@/lib/queries';
import type { Authorization } from '@/lib/types';
import { cn, formatDateTime, humanize } from '@/lib/utils';

export function TransactionsList({ accountId, sandbox }: { accountId: string; sandbox: boolean }) {
  const { data, isPending, error, refetch } = useAuthorizations(accountId);
  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard />}
        title="No card transactions yet"
        description="Purchases show up here as pending holds, then settle or get released."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      <AnimatePresence initial={false}>
        {data.map((auth) => (
          <motion.li
            key={auth.id}
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 py-3"
          >
            <TransactionRow auth={auth} sandbox={sandbox} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function TransactionRow({ auth, sandbox }: { auth: Authorization; sandbox: boolean }) {
  const action = useAuthorizationAction();
  const struck =
    auth.status === 'DECLINED' || auth.status === 'REVERSED' || auth.status === 'EXPIRED';

  async function run(kind: 'capture' | 'reverse') {
    try {
      await action.mutateAsync({ id: auth.id, action: kind });
      toast.success(kind === 'capture' ? 'Purchase settled' : 'Hold released');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
        <ShoppingBag className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{auth.merchantName}</p>
        <p className="text-xs text-muted">
          {formatDateTime(auth.createdAt)}
          {auth.declineReason && <> · {humanize(auth.declineReason)}</>}
        </p>
      </div>
      {sandbox && auth.status === 'HELD' && (
        <div className="hidden gap-1 sm:flex">
          <Tip content="Network settles the purchase">
            <Button
              size="sm"
              variant="subtle"
              onClick={() => run('capture')}
              disabled={action.isPending}
            >
              Capture
            </Button>
          </Tip>
          <Tip content="Merchant cancels the hold">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run('reverse')}
              disabled={action.isPending}
            >
              Reverse
            </Button>
          </Tip>
        </div>
      )}
      <div className="flex flex-col items-end gap-1">
        <p className={cn('tabular text-sm font-semibold', struck && 'text-subtle line-through')}>
          {formatMoney(auth.capturedAmount ?? auth.amount)}
        </p>
        <StatusBadge status={auth.status} />
      </div>
    </>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4 py-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
