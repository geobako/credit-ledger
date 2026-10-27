import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, sessionStore, setUnauthorizedHandler } from '@/lib/api';
import type { Session } from '@/lib/types';

interface SessionContextValue {
  session: Session | null;
  demoLogin: (email: string) => Promise<Session>;
  register: (email: string, name: string) => Promise<Session>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => sessionStore.read());
  const queryClient = useQueryClient();

  const apply = useCallback(
    (next: Session | null) => {
      sessionStore.write(next);
      queryClient.clear();
      setSession(next);
    },
    [queryClient],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      apply(null);
      toast.info('Your session ended. Please sign in again.');
    });
  }, [apply]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      demoLogin: async (email) => {
        const next = await api<Session>('/v1/auth/demo-login', {
          method: 'POST',
          body: { email },
        });
        apply(next);
        return next;
      },
      register: async (email, name) => {
        const next = await api<Session>('/v1/auth/register', {
          method: 'POST',
          body: { email, name },
        });
        apply(next);
        return next;
      },
      logout: () => apply(null),
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
