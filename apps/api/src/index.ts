import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { idSchema } from '@contapp/shared';
import { db, initDb } from './db/client.ts';
import { seedIfEmpty } from './db/seed.ts';
import { ledgers } from './db/schema.ts';
import { HttpError, type LedgerEnv } from './http.ts';
import { bucketRoutes, ensureDefaultBuckets, movementRoutes } from './routes/buckets.ts';
import { categoryRoutes } from './routes/categories.ts';
import { expenseRoutes } from './routes/expenses.ts';
import { incomeRoutes } from './routes/incomes.ts';
import { monthRoutes } from './routes/months.ts';
import { recurringRoutes } from './routes/recurring.ts';
import { settingsRoutes } from './routes/settings.ts';

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

const app = new Hono();
app.use(logger());
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

// En producción la API sirve también el front compilado (apps/web/dist).
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (process.env.NODE_ENV === 'production' && existsSync(webDist)) {
  const root = relative(process.cwd(), webDist);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

await initDb();
await seedIfEmpty();
for (const { id } of await db.select({ id: ledgers.id }).from(ledgers)) {
  await ensureDefaultBuckets(id);
}

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => console.log(`API en http://localhost:${port}`));
