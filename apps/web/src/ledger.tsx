import { createContext, type ReactNode, useContext } from 'react';
import { ApiError, useLedgers } from './api';
import { FullScreenMessage } from './components/ui';

// Ámbito activo (Personal, SL…). En la Fase 4 se añadirá un selector; de momento, Personal.
const LedgerContext = createContext<number | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error } = useLedgers();

  if (isPending) return <FullScreenMessage>Cargando…</FullScreenMessage>;
  if (error) {
    // Si la API responde (p. ej. 401 sin sesión), su mensaje ya explica el problema.
    const message = error instanceof ApiError ? error.message : `No se puede conectar con la API: ${error.message}`;
    return <FullScreenMessage>{message}</FullScreenMessage>;
  }

  // Tu propio Personal antes que uno que te hayan compartido.
  const ledger =
    data.find((l) => l.kind === 'personal' && l.role === 'owner') ??
    data.find((l) => l.kind === 'personal') ??
    data[0];
  if (!ledger) return <FullScreenMessage>No hay ningún ámbito configurado.</FullScreenMessage>;

  return <LedgerContext.Provider value={ledger.id}>{children}</LedgerContext.Provider>;
}

export function useLedgerId(): number {
  const id = useContext(LedgerContext);
  if (id === null) throw new Error('useLedgerId debe usarse dentro de <LedgerProvider>');
  return id;
}
