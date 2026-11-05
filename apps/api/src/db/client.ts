import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema.ts';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = process.env.DB_PATH ?? resolve(apiRoot, 'data/contapp.db');
mkdirSync(dirname(dbPath), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });

// Una escritura suelta que llega mientras otra petición tiene una transacción abierta falla con
// SQLITE_BUSY. No sirve el busy timeout de SQLite: el driver es síncrono y, al esperar, congelaría
// el proceso entero, incluida la transacción que tiene que terminar. Así que se reintenta aquí,
// esperando con setTimeout para que la transacción pueda avanzar.
const BUSY_RETRY_MS = 5000;

async function retryIfBusy<T>(run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + BUSY_RETRY_MS;
  for (let delay = 5; ; delay = Math.min(delay * 2, 100)) {
    try {
      return await run();
    } catch (err) {
      const busy = (err as { code?: string }).code === 'SQLITE_BUSY';
      if (!busy || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const execute = client.execute.bind(client);
const batch = client.batch.bind(client);
client.execute = ((...args: Parameters<typeof execute>) => retryIfBusy(() => execute(...args))) as typeof execute;
client.batch = ((...args: Parameters<typeof batch>) => retryIfBusy(() => batch(...args))) as typeof batch;

export const db = drizzle(client, { schema });

/** Transacción de Drizzle: lo que recibe el callback de transaction(). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

let queue: Promise<unknown> = Promise.resolve();

/**
 * Usa esto en vez de db.transaction(): ejecuta las transacciones de una en una.
 * Cada transacción abre su propia conexión, y si dos se solapan la segunda falla con
 * "database is locked". Esperar el bloqueo (busy timeout) tampoco sirve: el driver es
 * síncrono y congelaría el proceso, incluida la transacción que tendría que terminar.
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = queue.then(() => db.transaction(fn));
  queue = run.catch(() => {});
  return run;
}

export async function initDb() {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA journal_mode = WAL');
  await migrate(db, { migrationsFolder: resolve(apiRoot, 'drizzle') });
  console.log(`BD lista en ${dbPath}`);
}
