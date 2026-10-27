import { DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  presets = [],
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  presets?: bigint[];
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <DollarSign className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="0.00"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className="tabular h-12 pl-9 text-lg font-medium"
        />
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const text = formatMoney(p).replace(/[$,]/g, '');
            return (
              <button
                key={p.toString()}
                type="button"
                onClick={() => onChange(text)}
                className={cn(
                  'tabular rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-brand/50 hover:text-fg',
                  value === text && 'border-brand bg-brand/10 text-brand',
                )}
              >
                {formatMoney(p)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
