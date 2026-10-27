import { Fingerprint, Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Mono, Skeleton, Tip } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { cn, formatDateTime, shortId } from '@/lib/utils';
import { AccountFilter } from './AccountFilter';
import { useAccountFilter } from './useAccountFilter';
import { PageTitle } from './OpsConsole';
import { useAuditTrail, useAuditVerification } from './queries';

const ACTOR_TONES: Record<string, Tone> = {
  user: 'info',
  service: 'brand',
  provider: 'warning',
  system: 'neutral',
};

export function AuditPage() {
  const [accountId] = useAccountFilter();
  const trail = useAuditTrail(accountId);
  const verify = useAuditVerification();
  const v = verify.data;
  return (
    <>
      <PageTitle
        title="Audit trail"
        description="Who did what, when, with which request. Sealed into a SHA-256 hash chain so any edit is detectable."
        actions={
          <>
            <AccountFilter />
            <Button onClick={() => void verify.refetch()} loading={verify.isFetching}>
              <ShieldCheck /> Verify chain
            </Button>
          </>
        }
      />
      {verify.error && (
        <div className="mb-4">
          <ErrorState error={verify.error} />
        </div>
      )}
      {v && (
        <motion.div
          key={verify.dataUpdatedAt}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4"
        >
          <Panel
            className={cn(
              'flex items-center gap-4 p-4',
              v.ok ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5',
            )}
          >
            {v.ok ? (
              <ShieldCheck className="size-6 text-success" />
            ) : (
              <ShieldAlert className="size-6 text-danger" />
            )}
            <div className="text-sm">
              <p className="font-semibold">
                {v.ok ? 'Chain intact' : `Chain broken at #${v.brokenAt}`}
              </p>
              <p className="text-muted">
                {v.ok ? `${v.sealedEntries} sealed entries recomputed and matched.` : v.reason}{' '}
                {v.unsealedEntries > 0 && `${v.unsealedEntries} recent entries awaiting seal.`}
              </p>
            </div>
          </Panel>
        </motion.div>
      )}
      {trail.error ? (
        <ErrorState error={trail.error} onRetry={() => void trail.refetch()} />
      ) : trail.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : trail.data.length === 0 ? (
        <Panel>
          <EmptyState icon={<Fingerprint />} title="No audit entries" />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2/50 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3">Chain</th>
                  <th className="px-3 py-3">Action</th>
                  <th className="px-3 py-3">Actor</th>
                  <th className="px-3 py-3">Entity</th>
                  <th className="px-3 py-3">When</th>
                  <th className="px-5 py-3">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trail.data.map((e) => (
                  <tr key={e.seq} className="hover:bg-surface-2/40">
                    <td className="px-5 py-2.5">
                      {e.chainPosition ? (
                        <span className="inline-flex items-center gap-1 font-mono text-xs">
                          <Link2 className="size-3 text-success" />#{e.chainPosition}
                        </span>
                      ) : (
                        <Badge tone="warning">sealing</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{e.action}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={ACTOR_TONES[e.actor.type] ?? 'neutral'}>{e.actor.type}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Mono>
                        {e.entityType}:{shortId(e.entityId)}
                      </Mono>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                      {formatDateTime(e.occurredAt)}
                    </td>
                    <td className="px-5 py-2.5">
                      {e.hash ? (
                        <Tip content={<span className="break-all font-mono">{e.hash}</span>}>
                          <span>
                            <Mono>{e.hash.slice(0, 12)}…</Mono>
                          </span>
                        </Tip>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
