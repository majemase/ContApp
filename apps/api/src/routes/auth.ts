import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as client from 'openid-client';
import { HttpError } from '../http.ts';
import { OIDC_SCOPES, oidcConfig, oidcSettings } from '../oidc.ts';
import { endSession, startSession } from '../sessions.ts';
import { findOrCreateUser, updateProfile } from '../users.ts';

/**
 * Login con el IdP (OIDC, flujo authorization code con PKCE y cliente confidencial):
 *   GET  /auth/login     → redirige al IdP
 *   GET  /auth/callback  → el IdP vuelve aquí; se canjea el código y se abre sesión
 *   POST /auth/logout    → cierra la sesión de ContApp (no la del IdP)
 * Las tres son públicas (PUBLIC_API_PATHS en app.ts).
 */

/** Por qué falló un login. La web lo recibe en /?login_error=… y muestra un mensaje. */
export type LoginError = 'expired' | 'cancelled' | 'not_allowed' | 'inactive' | 'failed';

/** Un viaje de ida y vuelta al IdP en curso: lo necesario para validar la vuelta. */
interface LoginAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
/** Tope de intentos a la vez: /auth/login es público y cada visita guarda uno en memoria. */
const MAX_ATTEMPTS = 1000;
const ATTEMPT_COOKIE = 'contapp_login';

// En memoria: un proceso, y si se reinicia a mitad de un login basta con volver a pulsar el botón.
const attempts = new Map<string, LoginAttempt>();

function saveAttempt(attempt: LoginAttempt): string {
  const now = Date.now();
  for (const [id, a] of attempts) if (a.expiresAt <= now) attempts.delete(id);
  if (attempts.size >= MAX_ATTEMPTS) throw new HttpError(503, 'Demasiados inicios de sesión a la vez, prueba en un momento');
  const id = randomBytes(24).toString('base64url');
  attempts.set(id, attempt);
  return id;
}

/** Recupera el intento y lo borra: cada uno vale para una sola vuelta. */
function takeAttempt(id: string | undefined): LoginAttempt | null {
  if (!id) return null;
  const attempt = attempts.get(id);
  attempts.delete(id);
  return attempt && attempt.expiresAt > Date.now() ? attempt : null;
}

function requireSettings() {
  const settings = oidcSettings();
  if (!settings) throw new HttpError(404, 'El inicio de sesión no está configurado');
  return settings;
}

const groupsOf = (claims: Record<string, unknown> | undefined): string[] =>
  Array.isArray(claims?.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const authRoutes = new Hono()
  .get('/login', async (c) => {
    const settings = requireSettings();
    let config: client.Configuration;
    try {
      config = await oidcConfig(settings);
    } catch (err) {
      console.error('No se puede contactar con el IdP:', err);
      return c.redirect(`/?login_error=${'failed' satisfies LoginError}`);
    }

    const codeVerifier = client.randomPKCECodeVerifier();
    const attempt: LoginAttempt = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier,
      expiresAt: Date.now() + ATTEMPT_TTL_MS,
    };
    const id = saveAttempt(attempt);

    // Lax: el navegador la envía cuando el IdP redirige de vuelta (navegación GET de primer nivel).
    setCookie(c, ATTEMPT_COOKIE, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/api/auth',
      maxAge: ATTEMPT_TTL_MS / 1000,
    });

    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: settings.redirectUri,
      scope: OIDC_SCOPES,
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    return c.redirect(url.href);
  })

  .get('/callback', async (c) => {
    const settings = requireSettings();
    const fail = (error: LoginError) => c.redirect(`/?login_error=${error}`);

    const attempt = takeAttempt(getCookie(c, ATTEMPT_COOKIE));
    deleteCookie(c, ATTEMPT_COOKIE, { path: '/api/auth', secure: process.env.NODE_ENV === 'production' });
    if (!attempt) return fail('expired');
    // El usuario canceló en el IdP o el IdP rechazó la petición (p. ej. no está en el grupo).
    if (c.req.query('error')) return fail(c.req.query('error') === 'access_denied' ? 'not_allowed' : 'cancelled');

    let claims: Record<string, unknown> | undefined;
    try {
      const config = await oidcConfig(settings);
      // La URL de vuelta tal como la registró el IdP, con los parámetros que ha traído. No se usa
      // la URL de la petición: detrás del proxy (Vite, Caddy) el host y el esquema pueden cambiar.
      const currentUrl = new URL(settings.redirectUri);
      currentUrl.search = new URL(c.req.url).search;
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: attempt.codeVerifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
      // Si el IdP no pone los grupos en el ID token, se piden a userinfo.
      if (claims && !Array.isArray(claims.groups)) {
        claims = { ...(await client.fetchUserInfo(config, tokens.access_token, claims.sub as string)), ...claims };
      }
    } catch (err) {
      console.error('Login OIDC fallido:', err);
      return fail(err instanceof client.AuthorizationResponseError ? 'cancelled' : 'failed');
    }

    const sub = str(claims?.sub);
    if (!sub) return fail('failed');
    // Segunda barrera: el IdP ya limita el cliente al grupo, pero no dependemos solo de eso.
    if (!groupsOf(claims).includes(settings.requiredGroup)) return fail('not_allowed');

    const identity = { sub, email: str(claims?.email), name: str(claims?.name) ?? str(claims?.preferred_username) };
    const user = await findOrCreateUser(identity);
    if (!user.active) return fail('inactive');
    await updateProfile(user.id, identity);

    await startSession(c, user.id);
    return c.redirect('/');
  })

  .post('/logout', async (c) => {
    await endSession(c);
    return c.body(null, 204);
  });
