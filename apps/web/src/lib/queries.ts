import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api, newIdempotencyKey } from './api';
import type {
  ActivityItem,
  Authorization,
  AuthorizationDecision,
  Card,
  Closure,
  CreditAccount,
  Deposit,
  PaymentInstructions,
  Repayment,
} from './types';

export const keys = {
  accounts: ['accounts'] as const,
  account: (id: string) => ['accounts', id] as const,
  deposits: (id: string) => ['accounts', id, 'deposits'] as const,
  repayments: (id: string) => ['accounts', id, 'repayments'] as const,
  authorizations: (id: string) => ['accounts', id, 'authorizations'] as const,
  activity: (id: string) => ['accounts', id, 'activity'] as const,
  closure: (id: string) => ['accounts', id, 'closure'] as const,
};

export const useAccounts = () =>
  useQuery({ queryKey: keys.accounts, queryFn: () => api<CreditAccount[]>('/v1/credit-accounts') });

export const useAccount = (id: string | undefined) =>
  useQuery({
    queryKey: keys.account(id ?? ''),
    queryFn: () => api<CreditAccount>(`/v1/credit-accounts/${id}`),
    enabled: !!id,
  });

/** Lists poll gently so webhook-driven changes (settlements) show up on their own. */
const live = { refetchInterval: 5000 };

export const useDeposits = (id: string) =>
  useQuery({
    queryKey: keys.deposits(id),
    queryFn: () => api<Deposit[]>(`/v1/credit-accounts/${id}/collateral-deposits`),
    ...live,
  });

export const useRepayments = (id: string) =>
  useQuery({
    queryKey: keys.repayments(id),
    queryFn: () => api<Repayment[]>(`/v1/credit-accounts/${id}/repayments`),
    ...live,
  });

export const useAuthorizations = (id: string) =>
  useQuery({
    queryKey: keys.authorizations(id),
    queryFn: () => api<Authorization[]>(`/v1/credit-accounts/${id}/authorizations`),
    ...live,
  });

export const useActivity = (id: string) =>
  useQuery({
    queryKey: keys.activity(id),
    queryFn: () => api<ActivityItem[]>(`/v1/credit-accounts/${id}/activity`),
    ...live,
  });

export const useClosure = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.closure(id),
    queryFn: () => api<Closure>(`/v1/credit-accounts/${id}/closure`),
    enabled,
  });

/**
 * One Idempotency-Key per user intent: retries and double-clicks of the same submission reuse
 * it (the server replays the original result), and it rotates only once that intent succeeded.
 */
export function useIdempotencyKey() {
  const [key, setKey] = useState(newIdempotencyKey);
  const rotate = useCallback(() => setKey(newIdempotencyKey()), []);
  return [key, rotate] as const;
}

function useInvalidateAccount() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: keys.accounts }),
    [queryClient],
  );
}

export function useOpenAccount() {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      api<CreditAccount>('/v1/credit-accounts', { method: 'POST', idempotencyKey }),
    onSuccess: invalidate,
  });
}

export function useCreateDeposit(accountId: string) {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: ({ amount, idempotencyKey }: { amount: bigint; idempotencyKey: string }) =>
      api<{ deposit: Deposit; paymentInstructions: PaymentInstructions }>(
        `/v1/credit-accounts/${accountId}/collateral-deposits`,
        { method: 'POST', body: { amount: amount.toString(), currency: 'USD' }, idempotencyKey },
      ),
    onSuccess: invalidate,
  });
}

export function useCreateRepayment(accountId: string) {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: ({ amount, idempotencyKey }: { amount: bigint; idempotencyKey: string }) =>
      api<{ repayment: Repayment; paymentInstructions: PaymentInstructions }>(
        `/v1/credit-accounts/${accountId}/repayments`,
        { method: 'POST', body: { amount: amount.toString(), currency: 'USD' }, idempotencyKey },
      ),
    onSuccess: invalidate,
  });
}

export function useCardState() {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: ({ cardId, action }: { cardId: string; action: 'freeze' | 'unfreeze' }) =>
      api<Card>(`/v1/cards/${cardId}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useCloseAccount(accountId: string) {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      reason = 'CUSTOMER_REQUEST',
    }: {
      idempotencyKey: string;
      reason?: Closure['reason'];
    }) =>
      api<Closure>(`/v1/credit-accounts/${accountId}/closure`, {
        method: 'POST',
        body: { reason },
        idempotencyKey,
      }),
    onSuccess: invalidate,
  });
}

/* ---------- sandbox: stands in for the bank and the card network ---------- */

export function useSettlePayment() {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: ({ reference, outcome }: { reference: string; outcome: 'succeeded' | 'failed' }) =>
      api<{ ack: unknown }>(`/v1/sandbox/payments/${reference}/settle`, {
        method: 'POST',
        body: { outcome },
      }),
    onSuccess: invalidate,
  });
}

export function useSimulatePurchase() {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: (input: {
      cardId: string;
      amount: bigint;
      merchantName?: string;
      capture?: boolean;
    }) => simulatePurchase(input),
    onSuccess: invalidate,
  });
}

export function simulatePurchase({
  cardId,
  amount,
  merchantName,
  capture,
}: {
  cardId: string;
  amount: bigint;
  merchantName?: string;
  capture?: boolean;
}) {
  return api<{ decision: AuthorizationDecision; captured: unknown }>(
    `/v1/sandbox/cards/${cardId}/purchases`,
    { method: 'POST', body: { amount: amount.toString(), merchantName, capture } },
  );
}

export function useAuthorizationAction() {
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'capture' | 'reverse' }) =>
      api<Authorization>(`/v1/sandbox/authorizations/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
