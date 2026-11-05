import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { idSchema } from '@contapp/shared';
import { currentUser } from './auth.ts';
import { db } from './db/client.ts';
import { ledgerMembers, ledgers } from './db/schema.ts';
import { type AuthEnv, HttpError, type LedgerEnv } from './http.ts';
import { bucketRoutes, movementRoutes } from './routes/buckets.ts';
import { categoryRoutes } from './routes/categories.ts';
import { expenseRoutes } from './routes/expenses.ts';
import { incomeRoutes } from './routes/incomes.ts';
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
  .route('/months', monthRoutes);

const api = new Hono<AuthEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  // Todo lo demás necesita saber quién eres. /health no: lo usa el healthcheck, sin sesión.
  // En Hono, '/ledgers/*' incluye también '/ledgers'.
  .use('/ledgers/*', currentUser)
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
  console.error(err);
  return c.json({ error: 'Error interno del servidor' }, 500);
});
