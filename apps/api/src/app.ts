import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { idSchema } from '@contapp/shared';
import { db } from './db/client.ts';
import { ledgers } from './db/schema.ts';
import { HttpError, type LedgerEnv } from './http.ts';
import { bucketRoutes, movementRoutes } from './routes/buckets.ts';
import { categoryRoutes } from './routes/categories.ts';
import { expenseRoutes } from './routes/expenses.ts';
import { incomeRoutes } from './routes/incomes.ts';
import { monthRoutes } from './routes/months.ts';
import { recurringRoutes } from './routes/recurring.ts';
import { settingsRoutes } from './routes/settings.ts';

// La app sin arranque ni servidor: index.ts la sirve y los tests la llaman con app.request().

// Todo lo que cuelga de /api/ledgers/:ledgerId pertenece a un ámbito (Personal, SL…).
const ledgerScoped = new Hono<LedgerEnv>()
  .use(async (c, next) => {
    const parsed = idSchema.safeParse(c.req.param('ledgerId'));
    if (!parsed.success) throw new HttpError(400, 'Ámbito no válido');
    const [ledger] = await db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.id, parsed.data));
    if (!ledger) throw new HttpError(404, 'Ámbito no encontrado');
    c.set('ledgerId', ledger.id);
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

const api = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .get('/ledgers', async (c) => {
    const rows = await db
      .select({ id: ledgers.id, name: ledgers.name, kind: ledgers.kind })
      .from(ledgers)
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
