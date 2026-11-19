import * as client from 'openid-client';

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** URL de retorno registrada en el IdP (la que ve el navegador, p. ej. http://localhost:5173/api/auth/callback). */
  redirectUri: string;
  /** Grupo del IdP que hace falta para entrar. Pocket ID ya lo exige; aquí se comprueba otra vez. */
  requiredGroup: string;
}

const VARS = {
  issuer: 'OIDC_ISSUER',
  clientId: 'OIDC_CLIENT_ID',
  clientSecret: 'OIDC_CLIENT_SECRET',
  redirectUri: 'OIDC_REDIRECT_URI',
  requiredGroup: 'OIDC_REQUIRED_GROUP',
} as const satisfies Record<keyof OidcSettings, string>;

/** Lo que la app pide al IdP. `groups` trae el claim con los grupos del usuario. */
export const OIDC_SCOPES = 'openid profile email groups';

/**
 * La configuración del login, leída del entorno en cada llamada (los tests la cambian).
 * null si no hay ninguna variable OIDC_* (sin login: en desarrollo se usa DEV_USER_SUB).
 * Si solo hay algunas, falla: una configuración a medias es un error, no "sin login".
 */
export function oidcSettings(): OidcSettings | null {
  const entries = Object.entries(VARS).map(([key, name]) => [key, process.env[name]?.trim() || undefined] as const);
  if (entries.every(([, value]) => value === undefined)) return null;

  const missing = entries.filter(([, value]) => value === undefined).map(([key]) => VARS[key as keyof OidcSettings]);
  if (missing.length > 0) throw new Error(`Configuración OIDC incompleta: falta ${missing.join(', ')}`);
  return Object.fromEntries(entries) as unknown as OidcSettings;
}

let cached: { key: string; config: Promise<client.Configuration> } | null = null;

/**
 * Los datos del IdP (endpoints, claves), descubiertos la primera vez que hacen falta y no al
 * arrancar: si el IdP está caído, la app arranca igual y las sesiones abiertas siguen valiendo.
 * Si el descubrimiento falla, se reintenta en la siguiente petición.
 */
export function oidcConfig(settings: OidcSettings): Promise<client.Configuration> {
  const key = JSON.stringify(settings);
  if (cached?.key !== key) {
    const issuer = new URL(settings.issuer);
    // HTTP solo fuera de producción (Pocket ID en localhost y el IdP falso de los tests).
    const insecure = issuer.protocol === 'http:' && process.env.NODE_ENV !== 'production';
    const config = client.discovery(issuer, settings.clientId, settings.clientSecret, undefined, {
      execute: insecure ? [client.allowInsecureRequests] : [],
    });
    cached = { key, config };
    config.catch(() => {
      if (cached?.config === config) cached = null;
    });
  }
  return cached.config;
}
