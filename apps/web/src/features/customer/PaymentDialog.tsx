import { CheckCircle2, Copy, Landmark, Wallet, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { formatMoney, parseAmount } from '@/lib/money';
import {
  useCreateDeposit,
  useCreateRepayment,
  useIdempotencyKey,
  useSettlePayment,
} from '@/lib/queries';
import type { CreditAccount, PaymentInstructions } from '@/lib/types';

type Kind = 'deposit' | 'repayment';

const COPY: Record<Kind, { title: string; description: string; cta: string }> = {
  deposit: {
    title: 'Add collateral',
    description: 'Your credit limit grows by the amount you deposit, once the transfer clears.',
    cta: 'Get transfer details',
  },
  repayment: {
    title: 'Make a payment',
    description: 'Paying down your balance restores available credit as soon as it settles.',
    cta: 'Get transfer details',
  },
};

export function PaymentDialog({
  kind,
  account,
  open,
  onOpenChange,
  limits,
}: {
  kind: Kind;
  account: CreditAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limits: { min: bigint; max: bigint };
}) {
  const [value, setValue] = useState('');
  const [instructions, setInstructions] = useState<PaymentInstructions | null>(null);
  const [key, rotateKey] = useIdempotencyKey();
  const deposit = useCreateDeposit(account.id);
  const repayment = useCreateRepayment(account.id);
  const mutation = kind === 'deposit' ? deposit : repayment;
  const copy = COPY[kind];

  const amount = parseAmount(value);
  const error =
    value === ''
      ? null
      : amount === null
        ? 'Enter an amount like 250 or 250.00'
        : amount < limits.min
          ? `Minimum is ${formatMoney(limits.min)}`
          : amount > limits.max
            ? `Maximum is ${formatMoney(limits.max)}`
            : null;

  const presets =
    kind === 'deposit'
      ? [25_000n, 50_000n, 100_000n, 250_000n]
      : [limits.max, limits.max / 2n].filter((p, i, a) => p >= limits.min && a.indexOf(p) === i);

  function reset(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        setValue('');
        setInstructions(null);
        mutation.reset();
      }, 200);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amount === null || error) return;
    try {
      // Same key on retry → the server replays the first result instead of creating twice.
      const result = await mutation.mutateAsync({ amount, idempotencyKey: key });
      rotateKey();
      setInstructions(result.paymentInstructions);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent
        title={instructions ? 'Transfer details' : copy.title}
        description={instructions ? instructions.note : copy.description}
        icon={kind === 'deposit' ? <Landmark /> : <Wallet />}
      >
        {instructions ? (
          <TransferInstructions instructions={instructions} onDone={() => reset(false)} />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <Field
              label="Amount"
              htmlFor="amount"
              error={error}
              hint={
                kind === 'repayment'
                  ? `Balance owed: ${formatMoney(account.outstandingBalance)}`
                  : `Between ${formatMoney(limits.min)} and ${formatMoney(limits.max)}`
              }
            >
              <MoneyInput
                id="amount"
                value={value}
                onChange={setValue}
                invalid={!!error}
                presets={presets}
                autoFocus
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={mutation.isPending}
              disabled={amount === null || !!error}
            >
              {copy.cta}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransferInstructions({
  instructions,
  onDone,
}: {
  instructions: PaymentInstructions;
  onDone: () => void;
}) {
  const settle = useSettlePayment();
  const [outcome, setOutcome] = useState<'succeeded' | 'failed' | null>(null);

  async function simulate(result: 'succeeded' | 'failed') {
    try {
      await settle.mutateAsync({ reference: instructions.reference, outcome: result });
      setOutcome(result);
      if (result === 'succeeded') toast.success('Payment settled');
      else toast.warning('Payment failed at the bank');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface-2/50 text-sm">
        <Row
          label="Amount"
          value={<span className="tabular font-semibold">{formatMoney(instructions.amount)}</span>}
        />
        <Row
          label="Reference"
          value={
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(instructions.reference);
                toast.success('Reference copied');
              }}
              className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-brand"
            >
              {instructions.reference} <Copy className="size-3" />
            </button>
          }
        />
        <Row label="Provider" value={instructions.provider} />
      </dl>

      {outcome ? (
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-4 text-sm">
          {outcome === 'succeeded' ? (
            <CheckCircle2 className="size-5 text-success" />
          ) : (
            <XCircle className="size-5 text-danger" />
          )}
          <p>
            {outcome === 'succeeded'
              ? 'Funds confirmed by the bank. Your balances are updated.'
              : 'The bank reported the transfer as failed. Nothing changed.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">Sandbox</p>
          <p className="mt-1 text-sm text-muted">
            Simulate the bank’s signed webhook. Nothing changes until it arrives.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => simulate('succeeded')}
              loading={settle.isPending && settle.variables?.outcome === 'succeeded'}
              disabled={settle.isPending}
            >
              Bank confirms
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => simulate('failed')}
              loading={settle.isPending && settle.variables?.outcome === 'failed'}
              disabled={settle.isPending}
            >
              Bank rejects
            </Button>
          </div>
        </div>
      )}
      <Button variant="secondary" className="w-full" onClick={onDone}>
        {outcome ? 'Done' : 'I’ll do this later'}
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
