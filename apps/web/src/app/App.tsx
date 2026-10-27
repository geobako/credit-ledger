import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Skeleton } from '@/components/ui/misc';
import { LoginPage } from '@/features/auth/LoginPage';
import { useSession } from '@/features/auth/session';
import { CustomerHome } from '@/features/customer/CustomerHome';
import { AppShell } from './AppShell';

// Customers never download the back-office bundle.
const OpsConsole = lazy(() =>
  import('@/features/ops/OpsConsole').then((m) => ({ default: m.OpsConsole })),
);

export function App() {
  const { session } = useSession();
  if (!session) return <LoginPage />;
  const home = session.user.role === 'ops' ? '/ops' : '/';
  return (
    <AppShell>
      <Routes>
        {session.user.role === 'customer' && <Route path="/" element={<CustomerHome />} />}
        {session.user.role === 'ops' && (
          <Route
            path="/ops/*"
            element={
              <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
                <OpsConsole />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </AppShell>
  );
}
