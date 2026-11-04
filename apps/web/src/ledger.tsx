import { createContext, type ReactNode, useContext } from 'react';
import { useLedgers } from './api';
import { FullScreenMessage } from './components/ui';

// Ámbito activo (Personal, SL…). En la Fase 4 se añadirá un selector; de momento, Personal.
const LedgerContext = createContext<number | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error } = useLedgers();

  if (isPending) return <FullScreenMessage>Cargando…</FullScreenMessage>;
  if (error) return <FullScreenMessage>No se puede conectar con la API: {error.message}</FullScreenMessage>;

  const ledger = data.find((l) => l.kind === 'personal') ?? data[0];
  if (!ledger) return <FullScreenMessage>No hay ningún ámbito configurado.</FullScreenMessage>;

  return <LedgerContext.Provider value={ledger.id}>{children}</LedgerContext.Provider>;
}

export function useLedgerId(): number {
  const id = useContext(LedgerContext);
  if (id === null) throw new Error('useLedgerId debe usarse dentro de <LedgerProvider>');
  return id;
}
