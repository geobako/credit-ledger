import { AlertTriangle, DoorClosed } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api';
import { formatMoney, minor } from '@/lib/money';
import { useCloseAccount, useIdempotencyKey } from '@/lib/queries';
import type { CreditAccount } from '@/lib/types';
import { cn } from '@/lib/utils';
import { previewClosure } from './settlement';

export function CloseAccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: CreditAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const close = useCloseAccount(account.id);
  const [key] = useIdempotencyKey();
  const plan = previewClosure(account);
  const hasHolds = minor(account.heldAmount) > 0n;
  const blocked = hasHolds || plan.shortfall > 0n;

  async function confirm() {
    try {
      // On success the account reads CLOSED and the page swaps to the settlement summary.
      await close.mutateAsync({ idempotencyKey: key });
      toast.success('Account closed');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Close your account"
        description="Your card stops working immediately and your collateral is settled."
        icon={<DoorClosed />}
      >
        <div className="space-y-5">
          <Breakdown
            rows={[
              ['Collateral held', minor(account.collateral)],
              ['Balance owed', -plan.debt],
              ...(minor(account.refundDue) > 0n
                ? [['Overpayments owed to you', minor(account.refundDue)] as [string, bigint]]
                : []),
            ]}
            total={['You’ll receive', plan.payout]}
          />
          {hasHolds ? (
            <Warning>
              You have {formatMoney(account.heldAmount)} in pending card transactions. You can close
              once they settle or are released.
            </Warning>
          ) : plan.shortfall > 0n ? (
            <Warning>
              Your collateral doesn’t cover your balance. Pay at least {formatMoney(plan.shortfall)}{' '}
              first.
            </Warning>
          ) : plan.debt > 0n ? (
            <p className="text-sm text-muted">
              Your remaining balance of {formatMoney(plan.debt)} will be paid from your collateral.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
              Keep account
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={blocked}
              loading={close.isPending}
              onClick={confirm}
            >
              Close account
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Breakdown({ rows, total }: { rows: [string, bigint][]; total: [string, bigint] }) {
  return (
    <dl className="rounded-xl border border-border text-sm">
      <div className="space-y-2.5 p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt className="text-muted">{label}</dt>
            <dd className={cn('tabular', BigInt(value) < 0n && 'text-danger')}>
              {formatMoney(value)}
            </dd>
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t border-border bg-surface-2/60 px-4 py-3 font-semibold">
        <dt>{total[0]}</dt>
        <dd className="tabular">{formatMoney(total[1])}</dd>
      </div>
    </dl>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>{children}</p>
    </div>
  );
}
