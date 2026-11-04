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
export const db = drizzle(client, { schema });

export async function initDb() {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA journal_mode = WAL');
  await migrate(db, { migrationsFolder: resolve(apiRoot, 'drizzle') });
  console.log(`BD lista en ${dbPath}`);
}
