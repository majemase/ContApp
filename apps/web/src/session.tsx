import { createContext, type ReactNode, useContext, useState } from 'react';
import { ApiError, type Me, useMe } from './api';
import { FullScreenMessage } from './components/ui';

const SessionContext = createContext<Me | null>(null);

/** Por qué volvió el login sin sesión (lo pone la API en /?login_error=…). */
const LOGIN_ERRORS: Record<string, string> = {
  expired: 'El inicio de sesión ha caducado. Vuelve a intentarlo.',
  cancelled: 'Se ha cancelado el inicio de sesión.',
  not_allowed: 'Tu usuario no tiene acceso a ContApp. Pide que te añadan.',
  inactive: 'Tu usuario está desactivado.',
  failed: 'No se ha podido iniciar sesión. Inténtalo de nuevo en un momento.',
};

/** Lee el error del login de la URL una sola vez y lo quita, para que no siga ahí al recargar. */
function useLoginError(): string | null {
  const [error] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('login_error');
    if (!code) return null;
    params.delete('login_error');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
    return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.failed!;
  });
  return error;
}

/** Sin sesión, muestra la pantalla de login; con sesión, la app. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const loginError = useLoginError();
  const { data, isPending, error } = useMe();

  if (isPending) return <FullScreenMessage>Cargando…</FullScreenMessage>;
  if (error instanceof ApiError && error.status === 401) return <LoginScreen error={loginError} />;
  if (error) {
    const message = error instanceof ApiError ? error.message : `No se puede conectar con la API: ${error.message}`;
    return <FullScreenMessage>{message}</FullScreenMessage>;
  }
  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return me;
}

function LoginScreen({ error }: { error: string | null }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">ContApp</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Tu contabilidad personal</p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {error}
          </p>
        )}
        {/* Navegación completa, no fetch: el navegador tiene que ir al IdP y volver. */}
        <a
          href="/api/auth/login"
          className="flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Iniciar sesión
        </a>
        <p className="text-xs text-slate-500 dark:text-slate-400">Con tu passkey, en el servidor de acceso.</p>
      </div>
    </div>
  );
}
