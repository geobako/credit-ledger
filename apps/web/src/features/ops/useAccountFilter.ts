import { useSearchParams } from 'react-router';

/** ?account=<id> filter shared by the ledger and audit pages. */
export function useAccountFilter() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account') ?? undefined;
  const set = (id: string | undefined) => setParams(id ? { account: id } : {});
  return [accountId, set] as const;
}
