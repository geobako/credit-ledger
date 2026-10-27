import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-muted ring-border',
        success: 'bg-success/10 text-success ring-success/25',
        warning: 'bg-warning/12 text-warning ring-warning/30',
        danger: 'bg-danger/10 text-danger ring-danger/25',
        info: 'bg-info/10 text-info ring-info/25',
        brand: 'bg-brand/10 text-brand ring-brand/25',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type Tone = NonNullable<VariantProps<typeof badge>['tone']>;

export function Badge({
  tone,
  dot,
  className,
  children,
}: VariantProps<typeof badge> & { dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn(badge({ tone }), className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'success',
  CONFIRMED: 'success',
  SETTLED: 'success',
  CAPTURED: 'success',
  HELD: 'info',
  PENDING: 'warning',
  PENDING_COLLATERAL: 'warning',
  INACTIVE: 'warning',
  FROZEN: 'info',
  REVERSED: 'neutral',
  EXPIRED: 'neutral',
  CLOSED: 'neutral',
  DECLINED: 'danger',
  FAILED: 'danger',
  REJECTED: 'danger',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_COLLATERAL: 'Awaiting collateral',
  HELD: 'Pending',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot>
      {STATUS_LABELS[status] ?? status.toLowerCase().replace(/_/g, ' ')}
    </Badge>
  );
}
