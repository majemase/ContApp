import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
import { LedgerProvider } from './ledger';
import { FeedbackProvider } from './components/feedback';
import { BucketsPage } from './pages/BucketsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ClosePage } from './pages/ClosePage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { IncomesPage } from './pages/IncomesPage';
import { RecurringPage } from './pages/RecurringPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <LedgerProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="gastos" element={<ExpensesPage />} />
                <Route path="ingresos" element={<IncomesPage />} />
                <Route path="huchas" element={<BucketsPage />} />
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
      </FeedbackProvider>
    </QueryClientProvider>
  </StrictMode>,
);
