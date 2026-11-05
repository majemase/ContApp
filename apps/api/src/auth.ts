import { createMiddleware } from 'hono/factory';
import { type AuthEnv, HttpError } from './http.ts';
import { findOrCreateUser } from './users.ts';

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Falla cerrado: en producción no hay forma de iniciar sesión todavía (llegará con el IdP),
 * así que la API se niega a arrancar en vez de quedar abierta o inservible.
 */
export function assertAuthConfigured() {
  if (isProduction()) {
    throw new Error(
      'No hay login configurado: la API no arranca en producción hasta tener el IdP. ' +
        'En desarrollo usa DEV_USER_SUB (ver apps/api/.env.example).',
    );
  }
}

/**
 * Identifica al usuario de la petición y deja su id en el contexto (c.get('userId')).
 * De momento es el usuario de desarrollo (DEV_USER_SUB); con el IdP saldrá de la sesión.
 */
export const currentUser = createMiddleware<AuthEnv>(async (c, next) => {
  // Se lee en cada petición para que los tests puedan cambiar de usuario.
  // En producción se ignora aunque esté definida: el usuario de desarrollo nunca vale ahí.
  const sub = isProduction() ? undefined : process.env.DEV_USER_SUB;
  if (!sub) throw new HttpError(401, 'No has iniciado sesión');

  const user = await findOrCreateUser({ sub });
  if (!user.active) throw new HttpError(403, 'Tu usuario está desactivado');

  c.set('userId', user.id);
  await next();
});
