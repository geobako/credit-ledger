import * as T from '@radix-ui/react-tooltip';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-lg bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--border)_50%,var(--surface-2)_75%)] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-subtle [&_svg]:size-5">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex-1">
        <p className="font-medium text-danger">Couldn’t load this</p>
        <p className="mt-0.5 text-muted">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-medium text-fg hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function Tip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <T.Root delayDuration={200}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-fg px-2.5 py-1.5 text-xs text-bg shadow-lg"
        >
          {content}
          <T.Arrow className="fill-fg" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] text-muted', className)}>{children}</span>;
}
