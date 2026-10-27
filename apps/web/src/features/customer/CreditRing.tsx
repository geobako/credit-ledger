import { motion } from 'motion/react';
import { formatMoney, minor, ratio } from '@/lib/money';
import type { CreditAccount } from '@/lib/types';

const R = 70;
const C = 2 * Math.PI * R;

/** Limit split into spent (balance), pending (holds) and available. */
export function CreditRing({ account }: { account: CreditAccount }) {
  const limit = minor(account.creditLimit);
  const spent = ratio(minor(account.outstandingBalance), limit);
  const held = ratio(minor(account.heldAmount), limit);
  const segments = [
    { value: spent, className: 'stroke-brand', offset: 0 },
    { value: held, className: 'stroke-info/70', offset: spent },
  ];
  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-6 @md:flex-row">
        <div className="relative size-44 shrink-0">
          <svg viewBox="0 0 160 160" className="-rotate-90">
            <circle
              cx="80"
              cy="80"
              r={R}
              fill="none"
              strokeWidth="14"
              className="stroke-surface-2"
            />
            {segments.map((s, i) => (
              <motion.circle
                key={i}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                strokeWidth="14"
                strokeLinecap="butt"
                className={s.className}
                initial={false}
                animate={{
                  strokeDasharray: `${s.value * C} ${C}`,
                  strokeDashoffset: -s.offset * C,
                }}
                transition={{ type: 'spring', stiffness: 70, damping: 18 }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs font-medium text-muted">Available</p>
              <p className="tabular text-2xl font-semibold tracking-tight">
                {formatMoney(account.availableCredit)}
              </p>
              <p className="text-xs text-subtle">of {formatMoney(account.creditLimit)}</p>
            </div>
          </div>
        </div>
        <dl className="w-full max-w-xs space-y-3 text-sm">
          <Legend
            swatch="bg-brand"
            label="Balance owed"
            value={formatMoney(account.outstandingBalance)}
          />
          <Legend
            swatch="bg-info/70"
            label="Pending holds"
            value={formatMoney(account.heldAmount)}
          />
          <Legend
            swatch="bg-surface-2 ring-1 ring-border"
            label="Available"
            value={formatMoney(account.availableCredit)}
          />
        </dl>
      </div>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 whitespace-nowrap text-muted">
        <span className={`size-2.5 rounded-full ${swatch}`} /> {label}
      </dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
