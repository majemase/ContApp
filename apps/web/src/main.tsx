import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
import { ApiError, meKey } from './api';
import { LedgerProvider } from './ledger';
import { SessionProvider } from './session';
import { FeedbackProvider } from './components/feedback';
import { BucketsPage } from './pages/BucketsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ClosePage } from './pages/ClosePage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { IncomesPage } from './pages/IncomesPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { RecurringPage } from './pages/RecurringPage';
import { SettingsPage } from './pages/SettingsPage';

// Si una petición responde 401 (la sesión caducó o se cerró en otra pestaña), se vuelve a
// preguntar quién eres: también dará 401 y SessionProvider mostrará el login.
const onAuthError = (error: Error, queryKey?: readonly unknown[]) => {
  if (error instanceof ApiError && error.status === 401 && queryKey?.[0] !== meKey[0]) {
    void queryClient.invalidateQueries({ queryKey: meKey });
  }
};

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Un 401 o 403 no se arregla reintentando.
      retry: (failures, error) => !(error instanceof ApiError && [401, 403].includes(error.status)) && failures < 1,
    },
  },
  queryCache: new QueryCache({ onError: (error, query) => onAuthError(error, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (error) => onAuthError(error) }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <SessionProvider>
          <LedgerProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="gastos" element={<ExpensesPage />} />
                  <Route path="ingresos" element={<IncomesPage />} />
                  <Route path="huchas" element={<BucketsPage />} />
                  <Route path="inversiones" element={<InvestmentsPage />} />
                  <Route path="cerrar/:mes" element={<ClosePage />} />
                  <Route path="ajustes/recurrentes" element={<RecurringPage />} />
                  <Route path="recurrentes" element={<Navigate to="/ajustes/recurrentes" replace />} />
                  <Route path="ajustes" element={<SettingsPage />} />
                  <Route path="ajustes/categorias" element={<CategoriesPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </LedgerProvider>
        </SessionProvider>
      </FeedbackProvider>
    </QueryClientProvider>
  </StrictMode>,
);
