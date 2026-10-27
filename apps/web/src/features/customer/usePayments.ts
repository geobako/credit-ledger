import { useDeposits, useRepayments } from '@/lib/queries';
import type { Deposit, Repayment } from '@/lib/types';

export type PaymentItem =
  { kind: 'deposit'; value: Deposit } | { kind: 'repayment'; value: Repayment };

export function usePayments(accountId: string) {
  const deposits = useDeposits(accountId);
  const repayments = useRepayments(accountId);
  const items: PaymentItem[] = [
    ...(deposits.data ?? []).map((value) => ({ kind: 'deposit' as const, value })),
    ...(repayments.data ?? []).map((value) => ({ kind: 'repayment' as const, value })),
  ].sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt));
  return {
    items,
    isPending: deposits.isPending || repayments.isPending,
    error: deposits.error ?? repayments.error,
    refetch: () => Promise.all([deposits.refetch(), repayments.refetch()]),
  };
}
