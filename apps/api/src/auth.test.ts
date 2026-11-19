import { eq } from 'drizzle-orm';
import { OAuth2Server } from 'oauth2-mock-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.ts';
import { assertAuthConfigured } from './auth.ts';
import { db, initDb } from './db/client.ts';
import { sessions, users } from './db/schema.ts';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from './sessions.ts';
import { findOrCreateUser, LOCAL_OWNER_SUB, linkLocalOwner } from './users.ts';

// Login completo contra un IdP falso (oauth2-mock-server): firma ID tokens de verdad y
// redirige de vuelta con un código, así que se prueba el mismo flujo que con Pocket ID.

const REDIRECT_URI = 'http://localhost:5173/api/auth/callback';
const idp = new OAuth2Server();

/** Lo que el IdP falso meterá en el próximo ID token. */
let nextClaims: Record<string, unknown>;
/** Lo que devolverá su endpoint userinfo (por defecto, el mismo usuario sin grupos). */
let nextUserinfo: Record<string, unknown> | null;

function setOidcEnv() {
  process.env.OIDC_ISSUER = idp.issuer.url!;
  process.env.OIDC_CLIENT_ID = 'contapp-test';
  process.env.OIDC_CLIENT_SECRET = 'secreto-de-test';
  process.env.OIDC_REDIRECT_URI = REDIRECT_URI;
  process.env.OIDC_REQUIRED_GROUP = 'contapp';
}

beforeAll(async () => {
  await initDb();
  await idp.issuer.keys.generate('RS256');
  await idp.start(0, 'localhost');
  idp.service.on('beforeTokenSigning', (token) => {
    Object.assign(token.payload, nextClaims);
  });
  idp.service.on('beforeUserinfo', (res) => {
    res.body = nextUserinfo ?? { sub: nextClaims.sub };
  });
});

afterAll(() => idp.stop());

beforeEach(() => {
  setOidcEnv();
  nextClaims = { sub: 'pocket-juan', email: 'juan@ejemplo.org', name: 'Juan', groups: ['contapp'] };
  nextUserinfo = null;
});

afterEach(() => {
  for (const name of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_REQUIRED_GROUP', 'DEV_USER_SUB']) {
    delete process.env[name];
  }
  process.env.NODE_ENV = 'test';
});

/** Las cookies que pone una respuesta, como "nombre=valor" listas para mandarlas de vuelta. */
function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ');
}

const call = (path: string, cookie = '', init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { cookie, 'sec-fetch-site': 'same-origin', ...init.headers } });

/** Pulsa "Iniciar sesión": devuelve la URL a la que vuelve el IdP y la cookie del intento. */
async function goToIdp() {
  const login = await call('/api/auth/login');
  expect(login.status).toBe(302);
  const authorize = new URL(login.headers.get('location')!);
  expect(authorize.origin).toBe(idp.issuer.url);
  // El IdP falso no pide passkey: redirige al momento de vuelta con el código.
  const back = await fetch(authorize, { redirect: 'manual' });
  const callback = new URL(back.headers.get('location')!);
  expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
  return { authorize, callbackQuery: callback.search, attemptCookie: cookiesFrom(login) };
}

/** Login completo. Devuelve la respuesta del callback y la cookie de sesión. */
async function login() {
  const { callbackQuery, attemptCookie } = await goToIdp();
  const res = await call(`/api/auth/callback${callbackQuery}`, attemptCookie);
  return { res, session: cookiesFrom(res) };
}

describe('login con el IdP', () => {
  it('pide código con PKCE (S256), state, nonce y los scopes con grupos', async () => {
    const { authorize } = await goToIdp();
    const q = authorize.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('contapp-test');
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(q.get('scope')).toBe('openid profile email groups');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBeTruthy();
    expect(q.get('state')).toBeTruthy();
    expect(q.get('nonce')).toBeTruthy();
  });

  it('abre sesión, crea al usuario con su ámbito y guarda su nombre y email', async () => {
    const { res, session } = await login();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(session).toMatch(/^contapp_session=/);

    const me = await call('/api/me', session);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ name: 'Juan', email: 'juan@ejemplo.org', loginEnabled: true });

    const ledgers = await call('/api/ledgers', session);
    expect(((await ledgers.json()) as unknown[]).length).toBe(1);
  });

  it('la cookie es HttpOnly y SameSite=Lax', async () => {
    const { callbackQuery, attemptCookie } = await goToIdp();
    const res = await call(`/api/auth/callback${callbackQuery}`, attemptCookie);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('contapp_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('en la BD solo se guarda el hash del token, no el token', async () => {
    const { session } = await login();
    const token = session.split('=')[1]!;
    const rows = await db.select().from(sessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it('actualiza nombre y email si cambian en el IdP; el sub es el mismo usuario', async () => {
    await login();
    nextClaims = { ...nextClaims, sub: 'pocket-juan', name: 'Juan Pérez', email: 'otro@ejemplo.org' };
    const { session } = await login();
    expect(await (await call('/api/me', session)).json()).toMatchObject({ name: 'Juan Pérez', email: 'otro@ejemplo.org' });
    expect(await db.select().from(users).where(eq(users.sub, 'pocket-juan'))).toHaveLength(1);
  });

  it('sin el grupo de la app no entra, y no se crea el usuario', async () => {
    nextClaims = { ...nextClaims, sub: 'pocket-sin-grupo', groups: ['otra-app'] };
    const { res, session } = await login();
    expect(res.headers.get('location')).toBe('/?login_error=not_allowed');
    expect(session).not.toMatch(/contapp_session/);
    expect(await db.select().from(users).where(eq(users.sub, 'pocket-sin-grupo'))).toHaveLength(0);
  });

  it('si el ID token no trae grupos, los pide a userinfo', async () => {
    nextClaims = { sub: 'pocket-userinfo', name: 'Ana' };
    nextUserinfo = { sub: 'pocket-userinfo', groups: ['contapp'] };
    const { res } = await login();
    expect(res.headers.get('location')).toBe('/');
  });

  it('userinfo de otro usuario (otro sub) se rechaza', async () => {
    nextClaims = { sub: 'pocket-uno', name: 'Uno' };
    nextUserinfo = { sub: 'pocket-otro', groups: ['contapp'] };
    const { res } = await login();
    expect(res.headers.get('location')).toBe('/?login_error=failed');
  });

  it('sin claim de grupos (ni en el token ni en userinfo) no entra', async () => {
    nextClaims = { sub: 'pocket-sin-claim', name: 'X' };
    const { res } = await login();
    expect(res.headers.get('location')).toBe('/?login_error=not_allowed');
  });

  it('un usuario desactivado no puede iniciar sesión', async () => {
    nextClaims = { ...nextClaims, sub: 'pocket-baja' };
    await login();
    await db.update(users).set({ active: false }).where(eq(users.sub, 'pocket-baja'));
    const { res } = await login();
    expect(res.headers.get('location')).toBe('/?login_error=inactive');
  });

  it('si el IdP devuelve un error (p. ej. cancelado), vuelve a la web con el motivo', async () => {
    const { attemptCookie } = await goToIdp();
    const res = await call('/api/auth/callback?error=access_denied&state=x', attemptCookie);
    expect(res.headers.get('location')).toBe('/?login_error=not_allowed');
  });
});

describe('protecciones del callback', () => {
  it('sin la cookie del intento (otro navegador, o caducado) no abre sesión', async () => {
    const { callbackQuery } = await goToIdp();
    const res = await call(`/api/auth/callback${callbackQuery}`);
    expect(res.headers.get('location')).toBe('/?login_error=expired');
  });

  it('cada intento vale una sola vez', async () => {
    const { callbackQuery, attemptCookie } = await goToIdp();
    expect((await call(`/api/auth/callback${callbackQuery}`, attemptCookie)).headers.get('location')).toBe('/');
    expect((await call(`/api/auth/callback${callbackQuery}`, attemptCookie)).headers.get('location')).toBe('/?login_error=expired');
  });

  it('con un state distinto no abre sesión', async () => {
    const { callbackQuery, attemptCookie } = await goToIdp();
    const q = new URLSearchParams(callbackQuery);
    q.set('state', 'manipulado');
    const res = await call(`/api/auth/callback?${q}`, attemptCookie);
    expect(res.headers.get('location')).toMatch(/login_error=/);
    expect(cookiesFrom(res)).not.toMatch(/contapp_session/);
  });

  it('con el código de otro intento (sin su verificador PKCE ni su nonce) no abre sesión', async () => {
    const a = await goToIdp();
    const b = await goToIdp();
    const qa = new URLSearchParams(a.callbackQuery);
    const qb = new URLSearchParams(b.callbackQuery);
    qb.set('code', qa.get('code')!);
    const res = await call(`/api/auth/callback?${qb}`, b.attemptCookie);
    expect(cookiesFrom(res)).not.toMatch(/contapp_session/);
  });

  it('con un ID token de otro cliente no abre sesión', async () => {
    nextClaims = { ...nextClaims, aud: 'otra-app' };
    const { res, session } = await login();
    expect(res.headers.get('location')).toBe('/?login_error=failed');
    expect(session).not.toMatch(/contapp_session/);
  });
});

describe('sesiones', () => {
  it('sin cookie o con una inventada: 401', async () => {
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me', 'contapp_session=inventada')).status).toBe(401);
  });

  it('con login configurado, el usuario de desarrollo no vale', async () => {
    process.env.DEV_USER_SUB = 'local:owner';
    expect((await call('/api/me')).status).toBe(401);
  });

  it('cerrar sesión invalida la cookie aunque alguien la haya copiado', async () => {
    const { session } = await login();
    const out = await call('/api/auth/logout', session, { method: 'POST' });
    expect(out.status).toBe(204);
    expect((await call('/api/me', session)).status).toBe(401);
  });

  it('cerrar sesión sin sesión no falla', async () => {
    expect((await call('/api/auth/logout', '', { method: 'POST' })).status).toBe(204);
  });

  it(`caduca tras ${SESSION_IDLE_MS / 86400000} días sin usarla`, async () => {
    const { session } = await login();
    await db.update(sessions).set({ lastSeenAt: Date.now() - SESSION_IDLE_MS - 1000 });
    expect((await call('/api/me', session)).status).toBe(401);
  });

  it(`caduca a los ${SESSION_MAX_MS / 86400000} días aunque se use a diario`, async () => {
    const { session } = await login();
    await db.update(sessions).set({ createdAt: Date.now() - SESSION_MAX_MS - 1000, lastSeenAt: Date.now() });
    expect((await call('/api/me', session)).status).toBe(401);
  });

  it('desactivar a un usuario corta sus sesiones abiertas (403)', async () => {
    nextClaims = { ...nextClaims, sub: 'pocket-cortado' };
    const { session } = await login();
    await db.update(users).set({ active: false }).where(eq(users.sub, 'pocket-cortado'));
    expect((await call('/api/me', session)).status).toBe(403);
  });

  it('con el IdP caído, las sesiones abiertas siguen funcionando y el login avisa', async () => {
    const { session } = await login();
    process.env.OIDC_ISSUER = 'http://localhost:9'; // nadie escucha ahí
    expect((await call('/api/me', session)).status).toBe(200);
    const res = await call('/api/auth/login');
    expect(res.headers.get('location')).toBe('/?login_error=failed');
  });
});

describe('CSRF', () => {
  it('rechaza un formulario enviado desde otra web', async () => {
    const { session } = await login();
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: session, origin: 'https://malvada.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(403);
    expect((await call('/api/me', session)).status).toBe(200);
  });
});

describe('configuración', () => {
  it('en producción no arranca sin login', () => {
    for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_REQUIRED_GROUP']) delete process.env[k];
    process.env.NODE_ENV = 'production';
    expect(() => assertAuthConfigured()).toThrow(/no arranca/);
  });

  it('una configuración a medias es un error, también en desarrollo', () => {
    delete process.env.OIDC_CLIENT_SECRET;
    expect(() => assertAuthConfigured()).toThrow(/OIDC_CLIENT_SECRET/);
  });

  it('sin login configurado, /auth/login responde 404', async () => {
    for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_REQUIRED_GROUP']) delete process.env[k];
    expect((await call('/api/auth/login')).status).toBe(404);
  });
});

describe('enlazar local:owner con el usuario real', () => {
  it('tras enlazar, al iniciar sesión con ese sub ves los datos de siempre', async () => {
    const owner = await findOrCreateUser({ sub: LOCAL_OWNER_SUB });
    await linkLocalOwner('pocket-dueno');

    nextClaims = { ...nextClaims, sub: 'pocket-dueno', name: 'Dueño' };
    const { session } = await login();
    const [mine] = await db.select({ id: users.id }).from(users).where(eq(users.sub, 'pocket-dueno'));
    expect(mine!.id).toBe(owner.id);
    expect(await db.select().from(users).where(eq(users.sub, LOCAL_OWNER_SUB))).toHaveLength(0);
    expect((await call('/api/me', session)).status).toBe(200);
  });

  it('no se puede enlazar dos veces', async () => {
    await expect(linkLocalOwner('pocket-otra-vez')).rejects.toThrow(/No existe local:owner/);
  });

  it('si ya iniciaste sesión con ese sub, no fusiona: se niega', async () => {
    await findOrCreateUser({ sub: LOCAL_OWNER_SUB });
    await findOrCreateUser({ sub: 'pocket-ya-entro' });
    await expect(linkLocalOwner('pocket-ya-entro')).rejects.toThrow(/Ya existe un usuario/);
    expect(await db.select().from(users).where(eq(users.sub, LOCAL_OWNER_SUB))).toHaveLength(1);
  });
});
