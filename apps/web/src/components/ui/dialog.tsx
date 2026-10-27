import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl focus:outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.16,1,0.3,1)]',
          className,
        )}
      >
        <div className="mb-5 flex items-start gap-3 pr-8">
          {icon && (
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&_svg]:size-5">
              {icon}
            </div>
          )}
          <div>
            <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
        </div>
        {children}
        <D.Close
          className="absolute right-4 top-4 rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
          aria-label="Close"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
