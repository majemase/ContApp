import { createMiddleware } from 'hono/factory';
import { type AuthEnv, HttpError } from './http.ts';
import { oidcSettings } from './oidc.ts';
import { sessionUser } from './sessions.ts';
import { findOrCreateUser } from './users.ts';

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Falla cerrado: en producción la API no arranca sin el login con el IdP configurado
 * (las variables OIDC_*), en vez de quedar abierta o inservible.
 * oidcSettings() ya falla si la configuración está a medias, también en desarrollo.
 */
export function assertAuthConfigured() {
  const settings = oidcSettings();
  if (isProduction() && !settings) {
    throw new Error(
      'No hay login configurado: la API no arranca en producción sin las variables OIDC_* ' +
        '(ver apps/api/.env.example).',
    );
  }
}

/**
 * Identifica al usuario de la petición y deja su id en el contexto (c.get('userId')).
 * - Con login configurado (OIDC_*): el de la cookie de sesión.
 * - Sin login y fuera de producción: el usuario de desarrollo (DEV_USER_SUB).
 */
export const currentUser = createMiddleware<AuthEnv>(async (c, next) => {
  let user: { id: number; active: boolean } | null;
  if (oidcSettings()) {
    user = await sessionUser(c);
  } else {
    // Se lee en cada petición para que los tests puedan cambiar de usuario.
    // En producción se ignora aunque esté definida: el usuario de desarrollo nunca vale ahí.
    const sub = isProduction() ? undefined : process.env.DEV_USER_SUB;
    user = sub ? await findOrCreateUser({ sub }) : null;
  }

  if (!user) throw new HttpError(401, 'No has iniciado sesión');
  if (!user.active) throw new HttpError(403, 'Tu usuario está desactivado');

  c.set('userId', user.id);
  await next();
});
