import { Snowflake, Hourglass, Wifi, Ban } from 'lucide-react';
import { motion } from 'motion/react';
import type { Card } from '@/lib/types';
import { cn } from '@/lib/utils';

export function VirtualCard({ card, holder }: { card: Card | null; holder: string }) {
  const status = card?.status ?? 'INACTIVE';
  const dimmed = status !== 'ACTIVE';
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, rotateX: 8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ type: 'spring', stiffness: 140, damping: 18 }}
      className="@container relative aspect-[1.586] w-full max-w-[400px] [perspective:1000px]"
    >
      <div
        className={cn(
          'relative h-full overflow-hidden rounded-[22px] p-[6cqw] text-white shadow-[0_24px_60px_-20px_rgba(79,70,229,0.55)] transition-[filter] duration-500',
          'bg-[radial-gradient(120%_140%_at_0%_0%,#818cf8_0%,#4f46e5_35%,#1e1b4b_100%)]',
          dimmed && 'saturate-[0.35]',
        )}
      >
        <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-sky-400/30 blur-2xl" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_40%,rgba(255,255,255,0.18)_50%,transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
                Acme Secured
              </p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight">Credit</p>
            </div>
            <Wifi className="size-6 rotate-90 text-white/70" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-11 rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 shadow-inner" />
          </div>
          <div>
            <p className="whitespace-nowrap font-mono text-[5cqw] tracking-[0.16em] [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">
              •••• •••• •••• {card?.last4 ?? '••••'}
            </p>
            <div className="mt-[3cqw] flex items-end justify-between gap-2 text-[3cqw] leading-tight">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/50">Card holder</p>
                <p className="font-medium uppercase tracking-wide">{holder}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-white/50">Expires</p>
                <p className="font-mono font-medium">
                  {card
                    ? `${String(card.expiryMonth).padStart(2, '0')}/${String(card.expiryYear).slice(-2)}`
                    : '••/••'}
                </p>
              </div>
              <div className="flex -space-x-2.5">
                <span className="size-7 rounded-full bg-rose-500/90" />
                <span className="size-7 rounded-full bg-amber-400/90 mix-blend-screen" />
              </div>
            </div>
          </div>
        </div>
        {dimmed && <CardOverlay status={status} />}
      </div>
    </motion.div>
  );
}

function CardOverlay({ status }: { status: Card['status'] }) {
  const content = {
    FROZEN: { icon: Snowflake, label: 'Frozen', text: 'Purchases are blocked until you unfreeze' },
    INACTIVE: {
      icon: Hourglass,
      label: 'Inactive',
      text: 'Activates once your collateral is confirmed',
    },
    CLOSED: { icon: Ban, label: 'Closed', text: 'This card can no longer be used' },
    ACTIVE: null,
  }[status];
  if (!content) return null;
  const Icon = content.icon;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 grid place-items-center bg-slate-900/35 backdrop-blur-[3px]"
    >
      <div className="text-center">
        <div className="mx-auto mb-2 grid size-12 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
          <Icon className="size-6" />
        </div>
        <p className="font-semibold">{content.label}</p>
        <p className="mt-0.5 text-xs text-white/75">{content.text}</p>
      </div>
    </motion.div>
  );
}
