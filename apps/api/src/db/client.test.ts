import { inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, initDb, transaction } from './client.ts';
import { users } from './schema.ts';

beforeAll(async () => {
  await initDb();
});

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('escrituras concurrentes', () => {
  it('una escritura suelta espera a que termine una transacción abierta', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tx = transaction(async (t) => {
      await t.insert(users).values({ sub: 'en-tx' });
      await gate; // la transacción sigue abierta (y con el bloqueo) hasta aquí
    });
    await later(10);

    const write = db.insert(users).values({ sub: 'suelta' });
    setTimeout(release, 50);
    await Promise.all([tx, write]);

    const rows = await db.select({ sub: users.sub }).from(users).where(inArray(users.sub, ['en-tx', 'suelta']));
    expect(rows).toHaveLength(2);
  });

  it('dos transacciones a la vez se ejecutan una detrás de otra', async () => {
    await Promise.all(
      ['a', 'b', 'c'].map((sub) =>
        transaction(async (t) => {
          await t.insert(users).values({ sub: `tx-${sub}` });
          await later(5);
        }),
      ),
    );
    const rows = await db.select().from(users).where(inArray(users.sub, ['tx-a', 'tx-b', 'tx-c']));
    expect(rows).toHaveLength(3);
  });

  it('si una transacción falla, la siguiente funciona', async () => {
    await expect(
      transaction(async (t) => {
        await t.insert(users).values({ sub: 'revertido' });
        throw new Error('fallo');
      }),
    ).rejects.toThrow('fallo');
    await transaction((t) => t.insert(users).values({ sub: 'despues' }));
    const rows = await db.select().from(users).where(inArray(users.sub, ['revertido', 'despues']));
    expect(rows.map((r) => r.sub)).toEqual(['despues']);
  });
});
