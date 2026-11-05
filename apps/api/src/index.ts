import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { app } from './app.ts';
import { assertAuthConfigured } from './auth.ts';
import { db, initDb } from './db/client.ts';
import { ledgers } from './db/schema.ts';
import { ensureDefaultBuckets } from './routes/buckets.ts';

const server = new Hono();
server.use(logger());
server.route('/', app);

// En producción la API sirve también el front compilado (apps/web/dist).
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (process.env.NODE_ENV === 'production' && existsSync(webDist)) {
  const root = relative(process.cwd(), webDist);
  server.use('/*', serveStatic({ root }));
  server.get('*', serveStatic({ root, path: 'index.html' }));
}

assertAuthConfigured();
await initDb();
// Los ámbitos de cada usuario se crean en su primer acceso (users.ts); aquí solo se completan huchas.
for (const { id } of await db.select({ id: ledgers.id }).from(ledgers)) {
  await ensureDefaultBuckets(id);
}

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: server.fetch, port }, () => console.log(`API en http://localhost:${port}`));
