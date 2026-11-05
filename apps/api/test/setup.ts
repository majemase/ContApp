import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Se ejecuta antes de cada archivo de tests, antes de que se cargue db/client.ts:
// así cada archivo tiene una BD nueva y vacía, y nunca toca data/contapp.db.
const dir = mkdtempSync(join(tmpdir(), 'contapp-test-'));
process.env.DB_PATH = join(dir, 'test.db');

afterAll(() => rmSync(dir, { recursive: true, force: true }));
