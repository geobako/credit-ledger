import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AuditEntry,
  ChainVerification,
  JournalEntry,
  OutboxEvent,
  Overview,
  ReconciliationReport,
} from '@/lib/types';

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return search ? `?${search}` : '';
};

export const useOverview = () =>
  useQuery({
    queryKey: ['ops', 'overview'],
    queryFn: () => api<Overview>('/v1/ops/overview'),
    refetchInterval: 5000,
  });

export const useLedgerEntries = (creditAccountId?: string) =>
  useQuery({
    queryKey: ['ops', 'ledger', creditAccountId ?? 'all'],
    queryFn: () =>
      api<JournalEntry[]>(`/v1/ops/ledger/entries${qs({ creditAccountId, limit: '100' })}`),
  });

export const useAuditTrail = (creditAccountId?: string) =>
  useQuery({
    queryKey: ['ops', 'audit', creditAccountId ?? 'all'],
    queryFn: () => api<AuditEntry[]>(`/v1/ops/audit${qs({ creditAccountId, limit: '100' })}`),
    refetchInterval: 5000,
  });

/** On demand: these do real work server-side, so they only run when asked. */
export const useAuditVerification = () =>
  useQuery({
    queryKey: ['ops', 'audit-verify'],
    queryFn: () => api<ChainVerification>('/v1/ops/audit/verify'),
    enabled: false,
  });

export const useReconciliation = () =>
  useQuery({
    queryKey: ['ops', 'reconciliation'],
    queryFn: () => api<ReconciliationReport>('/v1/ops/reconciliation'),
  });

export const useOutbox = (status: 'pending' | 'published') =>
  useQuery({
    queryKey: ['ops', 'outbox', status],
    queryFn: () => api<OutboxEvent[]>(`/v1/ops/outbox?status=${status}`),
    refetchInterval: 5000,
  });
