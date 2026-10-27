import * as Switch from '@radix-ui/react-switch';
import { Store, Zap } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { errorMessage } from '@/lib/api';
import { formatMoney, parseAmount } from '@/lib/money';
import { useSimulatePurchase } from '@/lib/queries';
import type { CreditAccount } from '@/lib/types';
import { humanize } from '@/lib/utils';

const MERCHANTS = [
  'Blue Bottle Coffee',
  'Whole Foods Market',
  'Uber Trip',
  'Apple Store',
  'Netflix',
];

/** Stands in for the card network: what a merchant terminal would send. */
export function SimulatePurchase({ account }: { account: CreditAccount }) {
  const [value, setValue] = useState('');
  const [merchant, setMerchant] = useState(MERCHANTS[0]!);
  const [capture, setCapture] = useState(false);
  const purchase = useSimulatePurchase();
  const amount = parseAmount(value);
  const card = account.card;
  if (!card) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !card) return;
    try {
      const { decision } = await purchase.mutateAsync({
        cardId: card.id,
        amount,
        merchantName: merchant,
        capture,
      });
      if (decision.approved) {
        toast.success(`Approved · ${formatMoney(decision.amount)} at ${merchant}`, {
          description: capture
            ? 'Captured immediately'
            : 'Held against your limit until the merchant settles',
        });
        setValue('');
      } else {
        toast.error(`Declined · ${humanize(decision.declineReason ?? 'DECLINED')}`, {
          description: `${formatMoney(decision.amount)} at ${merchant}`,
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Panel className="border-dashed">
      <PanelHeader
        icon={<Store />}
        title="Card network simulator"
        description="Send a purchase as a merchant terminal would."
      />
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label="Merchant" htmlFor="merchant">
          <Input
            id="merchant"
            list="merchants"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            maxLength={120}
            required
          />
          <datalist id="merchants">
            {MERCHANTS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Amount" htmlFor="purchase-amount">
          <MoneyInput
            id="purchase-amount"
            value={value}
            onChange={setValue}
            presets={[450n, 2_500n, 12_000n]}
          />
        </Field>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Capture immediately</span>
            <span className="block text-xs text-muted">Otherwise it stays a pending hold</span>
          </span>
          <Switch.Root
            checked={capture}
            onCheckedChange={setCapture}
            className="relative h-5 w-9 shrink-0 rounded-full bg-border transition data-[state=checked]:bg-brand"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[18px]" />
          </Switch.Root>
        </label>
        <Button
          type="submit"
          className="w-full"
          loading={purchase.isPending}
          disabled={!amount || amount <= 0n}
        >
          <Zap /> Swipe card
        </Button>
      </form>
    </Panel>
  );
}
