import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Ledger, LedgerRole } from '@contapp/shared';
import { app } from './app.ts';
import { db, initDb } from './db/client.ts';
import { categories, ledgerMembers, users } from './db/schema.ts';
import { findOrCreateUser } from './users.ts';

// Juan y Manuel tienen cada uno su Personal. Manuel comparte el suyo con Ana (viewer) y Eva (editor).

/** Hace la petición como el usuario con ese sub (sin sub = sin sesión). */
async function as(sub: string | null, path: string, init?: { method?: string; body?: unknown }) {
  if (sub === null) delete process.env.DEV_USER_SUB;
  else process.env.DEV_USER_SUB = sub;
  return app.request(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function ledgersOf(sub: string): Promise<Ledger[]> {
  return (await as(sub, '/ledgers')).json() as Promise<Ledger[]>;
}

async function share(ledgerId: number, sub: string, role: LedgerRole) {
  const user = await findOrCreateUser({ sub });
  await db.insert(ledgerMembers).values({ userId: user.id, ledgerId, role });
}

const expense = { date: '2026-11-05', amountCents: 150, categoryId: null, note: 'Café' };

let juanLedger: number;
let manuelLedger: number;

beforeAll(async () => {
  await initDb();
  [{ id: juanLedger }] = (await ledgersOf('juan')) as [Ledger];
  [{ id: manuelLedger }] = (await ledgersOf('manuel')) as [Ledger];
  await share(manuelLedger, 'ana', 'viewer');
  await share(manuelLedger, 'eva', 'editor');
});

afterEach(() => {
  delete process.env.DEV_USER_SUB;
  process.env.NODE_ENV = 'test';
});

describe('identificación', () => {
  it('sin usuario responde 401, salvo /health', async () => {
    expect((await as(null, '/ledgers')).status).toBe(401);
    expect((await as(null, `/ledgers/${juanLedger}/expenses?month=2026-11`)).status).toBe(401);
    expect((await as(null, '/health')).status).toBe(200);
  });

  it('en producción ignora el usuario de desarrollo', async () => {
    process.env.NODE_ENV = 'production';
    expect((await as('juan', '/ledgers')).status).toBe(401);
  });

  it('un usuario desactivado recibe 403', async () => {
    await findOrCreateUser({ sub: 'baja' });
    await db.update(users).set({ active: false }).where(eq(users.sub, 'baja'));
    expect((await as('baja', '/ledgers')).status).toBe(403);
  });

  it('el primer acceso crea el usuario con su Personal, categorías y huchas', async () => {
    const [ledger, ...rest] = await ledgersOf('nuevo');
    expect(rest).toEqual([]);
    expect(ledger).toMatchObject({ name: 'Personal', kind: 'personal', role: 'owner' });

    const cats = await db.select().from(categories).where(eq(categories.ledgerId, ledger!.id));
    expect(cats.length).toBeGreaterThan(0);
    const buckets = (await (await as('nuevo', `/ledgers/${ledger!.id}/buckets`)).json()) as unknown[];
    expect(buckets.length).toBeGreaterThan(0);
  });

  it('dos primeros accesos a la vez crean un solo usuario y un solo ámbito', async () => {
    const [a, b] = await Promise.all([findOrCreateUser({ sub: 'doble' }), findOrCreateUser({ sub: 'doble' })]);
    expect(a.id).toBe(b.id);
    expect(await ledgersOf('doble')).toHaveLength(1);
  });
});

describe('ámbitos ajenos (IDOR)', () => {
  it('/ledgers solo devuelve los tuyos', async () => {
    const ids = (await ledgersOf('juan')).map((l) => l.id);
    expect(ids).toEqual([juanLedger]);
  });

  it('un ámbito ajeno responde 404, igual que uno inexistente', async () => {
    const ajeno = await as('juan', `/ledgers/${manuelLedger}/expenses?month=2026-11`);
    const inexistente = await as('juan', '/ledgers/99999/expenses?month=2026-11');
    expect(ajeno.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await ajeno.json()).toEqual(await inexistente.json());
  });

  it('no se puede escribir en un ámbito ajeno', async () => {
    const res = await as('juan', `/ledgers/${manuelLedger}/expenses`, { method: 'POST', body: expense });
    expect(res.status).toBe(404);
  });
});

describe('roles', () => {
  it('viewer puede leer pero no escribir', async () => {
    expect((await as('ana', `/ledgers/${manuelLedger}/expenses?month=2026-11`)).status).toBe(200);
    const res = await as('ana', `/ledgers/${manuelLedger}/expenses`, { method: 'POST', body: expense });
    expect(res.status).toBe(403);
  });

  it('editor puede escribir', async () => {
    const res = await as('eva', `/ledgers/${manuelLedger}/expenses`, { method: 'POST', body: expense });
    expect(res.status).toBe(201);
  });

  it('/ledgers incluye los compartidos con tu rol', async () => {
    const ana = await ledgersOf('ana');
    expect(ana.find((l) => l.id === manuelLedger)?.role).toBe('viewer');
    expect(ana.find((l) => l.role === 'owner')?.kind).toBe('personal');
  });
});
