import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { idSchema } from '@contapp/shared';
import { currentUser } from './auth.ts';
import { db } from './db/client.ts';
import { ledgerMembers, ledgers, users } from './db/schema.ts';
import { type AuthEnv, HttpError, type LedgerEnv } from './http.ts';
import { oidcSettings } from './oidc.ts';
import { authRoutes } from './routes/auth.ts';
import { bucketRoutes, movementRoutes } from './routes/buckets.ts';
import { categoryRoutes } from './routes/categories.ts';
import { expenseRoutes } from './routes/expenses.ts';
import { incomeRoutes } from './routes/incomes.ts';
import { investmentRoutes } from './routes/investments.ts';
import { monthRoutes } from './routes/months.ts';
import { recurringRoutes } from './routes/recurring.ts';
import { settingsRoutes } from './routes/settings.ts';

// La app sin arranque ni servidor: index.ts la sirve y los tests la llaman con app.request().

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Todo lo que cuelga de /api/ledgers/:ledgerId pertenece a un ámbito (Personal, SL…).
const ledgerScoped = new Hono<LedgerEnv>()
  .use(async (c, next) => {
    const parsed = idSchema.safeParse(c.req.param('ledgerId'));
    if (!parsed.success) throw new HttpError(400, 'Ámbito no válido');
    const [member] = await db
      .select({ role: ledgerMembers.role })
      .from(ledgerMembers)
      .where(and(eq(ledgerMembers.userId, c.get('userId')), eq(ledgerMembers.ledgerId, parsed.data)));
    // 404 y no 403: a quien no es miembro no le decimos ni que el ámbito existe.
    if (!member) throw new HttpError(404, 'Ámbito no encontrado');
    // Aquí y no ruta a ruta: una ruta nueva queda protegida aunque se olvide.
    if (member.role === 'viewer' && !READ_METHODS.has(c.req.method)) {
      throw new HttpError(403, 'Solo tienes permiso de lectura en este ámbito');
    }
    c.set('ledgerId', parsed.data);
    c.set('role', member.role);
    await next();
  })
  .route('/categories', categoryRoutes)
  .route('/recurring', recurringRoutes)
  .route('/expenses', expenseRoutes)
  .route('/incomes', incomeRoutes)
  .route('/settings', settingsRoutes)
  .route('/buckets', bucketRoutes)
  .route('/movements', movementRoutes)
  .route('/months', monthRoutes)
  .route('/investments', investmentRoutes);

/**
 * Las únicas rutas de la API que funcionan sin sesión (ruta completa, con /api).
 * Todo lo demás exige usuario, también las rutas que se añadan en el futuro y las que no
 * existen (401 antes que 404: a quien no ha iniciado sesión no le decimos qué rutas hay).
 * Añadir aquí una ruta es una decisión de seguridad: el test de app.test.ts lo vigila.
 */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  '/api/health', // healthcheck del contenedor
  '/api/auth/login', // lleva al IdP
  '/api/auth/callback', // el IdP vuelve aquí
  '/api/auth/logout', // no falla sin sesión: solo borra la cookie
]);

const api = new Hono<AuthEnv>()
  // Rechaza formularios enviados desde otra web (CSRF). Las peticiones JSON de otro origen ya
  // las bloquea el navegador (CORS), y la cookie de sesión es SameSite=Lax.
  .use(csrf())
  .use((c, next) => (PUBLIC_API_PATHS.has(c.req.path) ? next() : currentUser(c, next)))
  .get('/health', (c) => c.json({ ok: true }))
  .route('/auth', authRoutes)
  // Quién eres: la web lo usa para saber si hay sesión y para mostrar tu nombre.
  .get('/me', async (c) => {
    const [me] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, c.get('userId')));
    return c.json({ ...me, loginEnabled: oidcSettings() !== null });
  })
  // Solo los ámbitos de los que eres miembro, con tu rol en cada uno.
  .get('/ledgers', async (c) => {
    const rows = await db
      .select({ id: ledgers.id, name: ledgers.name, kind: ledgers.kind, role: ledgerMembers.role })
      .from(ledgerMembers)
      .innerJoin(ledgers, eq(ledgers.id, ledgerMembers.ledgerId))
      .where(eq(ledgerMembers.userId, c.get('userId')))
      .orderBy(asc(ledgers.id));
    return c.json(rows);
  })
  .route('/ledgers/:ledgerId', ledgerScoped);

export const app = new Hono();
app.route('/api', api);
// Sin esto, en producción una ruta de API inexistente devolvería el index.html de la web.
app.all('/api/*', (c) => c.json({ error: 'Ruta no encontrada' }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, issues: err.issues }, err.status);
  }
  // Las de los middlewares de Hono (p. ej. csrf → 403) traen ya su respuesta.
  if (err instanceof HTTPException) {
    return c.json({ error: err.status === 403 ? 'Petición rechazada: no viene de esta web' : err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Error interno del servidor' }, 500);
});
