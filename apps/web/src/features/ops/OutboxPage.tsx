import { Send } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, Mono, Skeleton } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, shortId } from '@/lib/utils';
import { PageTitle } from './OpsConsole';
import { useOutbox } from './queries';

export function OutboxPage() {
  const [status, setStatus] = useState<'pending' | 'published'>('published');
  const { data, isPending, error, refetch } = useOutbox(status);
  return (
    <>
      <PageTitle
        title="Event outbox"
        description="Domain events written in the same transaction as the change, then published at-least-once by a relay."
        actions={
          <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <TabsList>
              <TabsTrigger value="published">Published</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : data.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Send />}
            title={
              status === 'pending'
                ? 'Nothing waiting: the relay is caught up'
                : 'No events published yet'
            }
          />
        </Panel>
      ) : (
        <Panel className="divide-y divide-border">
          {data.map((e) => (
            <details key={e.id} className="group px-5 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                <Mono className="w-14 shrink-0">#{e.seq}</Mono>
                <span className="font-medium">{e.eventType}</span>
                <Mono className="hidden sm:inline">
                  {e.aggregateType}:{shortId(e.aggregateId)}
                </Mono>
                <span className="ml-auto flex items-center gap-2 text-xs text-muted">
                  {e.attempts > 0 && (
                    <Badge tone={e.lastError ? 'danger' : 'neutral'}>{e.attempts} attempts</Badge>
                  )}
                  {formatDateTime(e.publishedAt ?? e.occurredAt)}
                </span>
              </summary>
              <pre className="mt-3 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
              {e.lastError && <p className="mt-2 text-xs text-danger">{e.lastError}</p>}
            </details>
          ))}
        </Panel>
      )}
    </>
  );
}
