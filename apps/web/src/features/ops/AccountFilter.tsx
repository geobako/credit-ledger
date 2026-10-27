import { X } from 'lucide-react';
import { useAccounts } from '@/lib/queries';
import { shortId } from '@/lib/utils';
import { useAccountFilter } from './useAccountFilter';

export function AccountFilter() {
  const [accountId, setAccountId] = useAccountFilter();
  const { data } = useAccounts();
  return (
    <div className="relative">
      <select
        value={accountId ?? ''}
        onChange={(e) => setAccountId(e.target.value || undefined)}
        className="h-9 appearance-none rounded-lg border border-border bg-surface pl-3 pr-9 text-sm shadow-xs focus:border-ring focus:outline-none"
      >
        <option value="">All accounts</option>
        {data?.map((a) => (
          <option key={a.id} value={a.id}>
            {shortId(a.id)} · ••{a.card?.last4} · {a.status.toLowerCase()}
          </option>
        ))}
      </select>
      {accountId && (
        <button
          onClick={() => setAccountId(undefined)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg"
          aria-label="Clear filter"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
