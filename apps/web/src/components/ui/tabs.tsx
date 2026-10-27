import * as T from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: T.TabsListProps) {
  return (
    <T.List
      className={cn('inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted transition hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}
