import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import { App } from './app/App';
import { ApiError } from './lib/api';
import { SessionProvider } from './features/auth/session';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: true,
      // Client errors (403/404/422…) won't fix themselves; only retry transient failures.
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
    // Never auto-retry writes: retries are explicit and reuse the same Idempotency-Key.
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Tooltip.Provider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster position="bottom-right" richColors closeButton theme="system" />
        </Tooltip.Provider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
