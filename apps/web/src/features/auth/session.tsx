import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { api, onSessionChange, refreshSession, setAccessToken, signOut } from '@/lib/api';
import type { Session } from '@/lib/types';

interface SessionContextValue {
  /** `undefined` while the stored session is being restored on load. */
  session: Session | null | undefined;
  login: (email: string, password: string) => Promise<Session>;
  register: (email: string, name: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Refresh this long before the access token expires, so requests rarely meet a 401. */
const REFRESH_AHEAD_SECONDS = 60;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const userId = useRef<string | null>(null);

  const apply = useCallback(
    (next: Session | null) => {
      setAccessToken(next?.accessToken ?? null);
      // A different user (or none): drop every cached query from the previous one.
      if ((next?.user.id ?? null) !== userId.current) queryClient.clear();
      userId.current = next?.user.id ?? null;
      setSession(next);
    },
    [queryClient],
  );

  // On load: restore the session from the httpOnly refresh cookie, if there is one.
  useEffect(() => {
    void refreshSession().then(apply);
  }, [apply]);

  // Refreshes triggered by a 401 inside api() report back here.
  useEffect(() => {
    onSessionChange((next) => {
      if (!next) toast.info('Your session ended. Please sign in again.');
      apply(next);
    });
  }, [apply]);

  // Proactive refresh shortly before expiry.
  useEffect(() => {
    if (!session) return;
    const delay = Math.max(5, session.expiresIn - REFRESH_AHEAD_SECONDS) * 1000;
    const timer = setTimeout(() => {
      void refreshSession().then((next) => {
        if (!next) toast.info('Your session ended. Please sign in again.');
        apply(next);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [session, apply]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      login: async (email, password) => {
        const next = await api<Session>('/v1/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        apply(next);
        return next;
      },
      register: async (email, name, password) => {
        const next = await api<Session>('/v1/auth/register', {
          method: 'POST',
          body: { email, name, password },
        });
        apply(next);
        return next;
      },
      logout: async () => {
        await signOut();
        apply(null);
      },
    }),
    [session, apply],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
