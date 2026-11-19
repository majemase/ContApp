import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { db } from './db/client.ts';
import { sessions, users } from './db/schema.ts';

const DAY = 24 * 60 * 60 * 1000;
/** Sin usarla durante este tiempo, la sesión caduca. */
export const SESSION_IDLE_MS = 30 * DAY;
/** Aunque se use a diario, la sesión caduca a los 90 días: hay que volver a pasar por el IdP. */
export const SESSION_MAX_MS = 90 * DAY;
/** El último uso se apunta como mucho una vez por hora, no en cada petición. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * En producción, __Host-: el navegador solo la acepta con Secure, sin Domain y con Path=/,
 * así que ningún subdominio puede pisarla. En desarrollo (http) no se puede usar.
 */
export const sessionCookieName = () => (isProduction() ? '__Host-contapp_session' : 'contapp_session');

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Abre una sesión para el usuario y deja la cookie en la respuesta. */
export async function startSession(c: Context, userId: number): Promise<void> {
  const now = Date.now();
  // De paso, se borran las caducadas de todos: así la tabla no crece sin límite.
  await db.delete(sessions).where(or(lt(sessions.lastSeenAt, now - SESSION_IDLE_MS), lt(sessions.createdAt, now - SESSION_MAX_MS)));

  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ tokenHash: hash(token), userId, createdAt: now, lastSeenAt: now });
  setCookie(c, sessionCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_MS / 1000,
  });
}

/**
 * El usuario de la sesión de la cookie, o null si no hay sesión válida (sin cookie, caducada,
 * cerrada o de un usuario que ya no existe). Si el usuario está desactivado se devuelve igual,
 * con active = false: quien llama decide la respuesta (403).
 */
export async function sessionUser(c: Context): Promise<{ id: number; active: boolean } | null> {
  const token = getCookie(c, sessionCookieName());
  if (!token) return null;

  const now = Date.now();
  const [row] = await db
    .select({ tokenHash: sessions.tokenHash, lastSeenAt: sessions.lastSeenAt, id: users.id, active: users.active })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hash(token)),
        gt(sessions.lastSeenAt, now - SESSION_IDLE_MS),
        gt(sessions.createdAt, now - SESSION_MAX_MS),
      ),
    );
  if (!row) return null;

  if (now - row.lastSeenAt > TOUCH_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, row.tokenHash));
  }
  return { id: row.id, active: row.active };
}

/** Cierra la sesión de la cookie (si la hay) y borra la cookie. No falla si no había sesión. */
export async function endSession(c: Context): Promise<void> {
  const token = getCookie(c, sessionCookieName());
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
  deleteCookie(c, sessionCookieName(), { path: '/', secure: isProduction() });
}
