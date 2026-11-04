import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  type Bucket,
  bucketInputSchema,
  monthSchema,
  movementInputSchema,
  toMonth,
  transferInputSchema,
} from '@contapp/shared';
import { db } from '../db/client.ts';
import { bucketMovements, buckets, recurringExpenses } from '../db/schema.ts';
import { HttpError, type LedgerEnv, notFound, paramId, parseJson } from '../http.ts';
import { loadSettings, saveSettings } from './settings.ts';

/**
 * Huchas por defecto la primera vez: fondo de emergencia, colchón y ahorro, con un reparto del
 * extra inicial (40 % emergencia · 30 % colchón · 20 % ahorro · 10 % libre). Todo se puede cambiar.
 */
export async function ensureDefaultBuckets(ledgerId: number) {
  const [existing] = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.ledgerId, ledgerId), sql`${buckets.type} <> 'provision'`))
    .limit(1);
  if (existing) return;

  const created = await db
    .insert(buckets)
    .values([
      { ledgerId, name: 'Fondo de emergencia', icon: '🛟', type: 'emergency' },
      { ledgerId, name: 'Colchón de verano', icon: '🏖️', type: 'cushion' },
      { ledgerId, name: 'Ahorro', icon: '🐷', type: 'savings' },
    ])
    .returning({ id: buckets.id, type: buckets.type });
  const idOf = (type: string) => created.find((b) => b.type === type)!.id;

  const settings = await loadSettings(ledgerId);
  await saveSettings(ledgerId, {
    ...settings,
    savingsBucketId: settings.savingsBucketId ?? idOf('savings'),
    extraRules:
      settings.extraRules.length > 0
        ? settings.extraRules
        : [
            { bucketId: idOf('emergency'), pct: 40 },
            { bucketId: idOf('cushion'), pct: 30 },
            { bucketId: idOf('savings'), pct: 20 },
            { bucketId: null, pct: 10 },
          ],
  });
}

/** Cada provisión tiene su hucha; se crea si falta y mantiene el nombre del recurrente. */
async function syncProvisionBuckets(ledgerId: number) {
  const provisions = await db
    .select({ id: recurringExpenses.id, name: recurringExpenses.name, bucketId: buckets.id, bucketName: buckets.name })
    .from(recurringExpenses)
    .leftJoin(buckets, eq(buckets.recurringExpenseId, recurringExpenses.id))
    .where(and(eq(recurringExpenses.ledgerId, ledgerId), eq(recurringExpenses.type, 'provision')));

  for (const p of provisions) {
    if (p.bucketId === null) {
      await db.insert(buckets).values({ ledgerId, name: p.name, icon: '📅', type: 'provision', recurringExpenseId: p.id });
    } else if (p.bucketName !== p.name) {
      await db.update(buckets).set({ name: p.name }).where(eq(buckets.id, p.bucketId));
    }
  }
}

async function loadBuckets(ledgerId: number, opts: { id?: number; includeArchived?: boolean } = {}): Promise<Bucket[]> {
  const balance = sql<number>`coalesce(sum(${bucketMovements.amountCents}), 0)`.mapWith(Number);
  const conditions = [eq(buckets.ledgerId, ledgerId)];
  if (opts.id !== undefined) conditions.push(eq(buckets.id, opts.id));
  else if (!opts.includeArchived) conditions.push(eq(buckets.archived, false));

  return db
    .select({
      id: buckets.id,
      ledgerId: buckets.ledgerId,
      name: buckets.name,
      icon: buckets.icon,
      type: buckets.type,
      targetCents: buckets.targetCents,
      recurringExpenseId: buckets.recurringExpenseId,
      archived: buckets.archived,
      balanceCents: balance,
    })
    .from(buckets)
    .leftJoin(bucketMovements, eq(bucketMovements.bucketId, buckets.id))
    .where(and(...conditions))
    .groupBy(buckets.id)
    .orderBy(asc(buckets.id));
}

async function loadBucket(ledgerId: number, id: number): Promise<Bucket> {
  const [bucket] = await loadBuckets(ledgerId, { id });
  return bucket ?? notFound('Hucha');
}

const movementColumns = {
  id: bucketMovements.id,
  bucketId: bucketMovements.bucketId,
  amountCents: bucketMovements.amountCents,
  date: bucketMovements.date,
  month: bucketMovements.month,
  kind: bucketMovements.kind,
  affectsBudget: bucketMovements.affectsBudget,
  note: bucketMovements.note,
  createdAt: bucketMovements.createdAt,
};

export const bucketRoutes = new Hono<LedgerEnv>()
  .get('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    await syncProvisionBuckets(ledgerId);
    return c.json(await loadBuckets(ledgerId, { includeArchived: c.req.query('includeArchived') === 'true' }));
  })

  .post('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, bucketInputSchema);
    const [row] = await db.insert(buckets).values({ ...input, ledgerId }).returning({ id: buckets.id });
    return c.json(await loadBucket(ledgerId, row!.id), 201);
  })

  .put('/:id', async (c) => {
    const ledgerId = c.get('ledgerId');
    const current = await loadBucket(ledgerId, paramId(c));
    const input = await parseJson(c, bucketInputSchema);
    // Las huchas de provisión mantienen su tipo y su nombre (el del recurrente).
    const values =
      current.type === 'provision' ? { icon: input.icon, targetCents: input.targetCents } : input;
    await db.update(buckets).set(values).where(eq(buckets.id, current.id));
    return c.json(await loadBucket(ledgerId, current.id));
  })

  // Si tiene movimientos se archiva (para no perder el histórico); si no, se borra.
  .delete('/:id', async (c) => {
    const ledgerId = c.get('ledgerId');
    const bucket = await loadBucket(ledgerId, paramId(c));
    if (bucket.balanceCents !== 0) {
      throw new HttpError(400, 'La hucha tiene dinero: pásalo a otra hucha antes de borrarla');
    }
    if (bucket.type === 'provision' && bucket.recurringExpenseId !== null) {
      throw new HttpError(400, 'Esta hucha es de una provisión: borra o finaliza el gasto recurrente');
    }
    const settings = await loadSettings(ledgerId);
    const rules = [...settings.extraRules, ...settings.oneOffRules];
    if (settings.savingsBucketId === bucket.id || rules.some((r) => r.bucketId === bucket.id)) {
      throw new HttpError(400, 'La hucha se usa en Ajustes (ahorro o reparto del extra): cámbialo primero');
    }
    const [hasMovements] = await db
      .select({ id: bucketMovements.id })
      .from(bucketMovements)
      .where(eq(bucketMovements.bucketId, bucket.id))
      .limit(1);
    if (hasMovements) {
      await db.update(buckets).set({ archived: true }).where(eq(buckets.id, bucket.id));
      return c.json({ archived: true });
    }
    await db.delete(buckets).where(eq(buckets.id, bucket.id));
    return c.json({ archived: false });
  })

  .post('/:id/restore', async (c) => {
    const ledgerId = c.get('ledgerId');
    const bucket = await loadBucket(ledgerId, paramId(c));
    await db.update(buckets).set({ archived: false }).where(eq(buckets.id, bucket.id));
    return c.json(await loadBucket(ledgerId, bucket.id));
  })

  .get('/:id/movements', async (c) => {
    const ledgerId = c.get('ledgerId');
    const bucket = await loadBucket(ledgerId, paramId(c));
    const rows = await db
      .select(movementColumns)
      .from(bucketMovements)
      .where(eq(bucketMovements.bucketId, bucket.id))
      .orderBy(desc(bucketMovements.date), desc(bucketMovements.id));
    return c.json(rows);
  });

export const movementRoutes = new Hono<LedgerEnv>()
  // GET /movements?month=2026-11 → movimientos de todas las huchas en ese mes
  .get('/', async (c) => {
    const month = monthSchema.safeParse(c.req.query('month'));
    if (!month.success) throw new HttpError(400, 'Indica el mes (?month=YYYY-MM)');
    const rows = await db
      .select(movementColumns)
      .from(bucketMovements)
      .where(and(eq(bucketMovements.ledgerId, c.get('ledgerId')), eq(bucketMovements.month, month.data)))
      .orderBy(desc(bucketMovements.date), desc(bucketMovements.id));
    return c.json(rows);
  })

  .post('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, movementInputSchema);
    const bucket = await loadBucket(ledgerId, input.bucketId);
    if (bucket.archived) throw new HttpError(400, 'La hucha está archivada');
    if (input.amountCents < 0 && bucket.balanceCents + input.amountCents < 0) {
      throw new HttpError(400, `No hay tanto dinero en la hucha (tiene ${(bucket.balanceCents / 100).toFixed(2)} €)`);
    }
    const [row] = await db
      .insert(bucketMovements)
      .values({
        ...input,
        ledgerId,
        // El saldo inicial no pertenece a ningún mes; los movimientos manuales sí.
        month: input.kind === 'initial' ? null : toMonth(input.date),
        affectsBudget: input.kind === 'manual' && input.affectsBudget,
      })
      .returning(movementColumns);
    return c.json(row, 201);
  })

  .post('/transfer', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, transferInputSchema);
    const from = await loadBucket(ledgerId, input.fromBucketId);
    const to = await loadBucket(ledgerId, input.toBucketId);
    if (from.archived || to.archived) throw new HttpError(400, 'Una de las huchas está archivada');
    if (from.balanceCents < input.amountCents) {
      throw new HttpError(400, `No hay tanto dinero en «${from.name}»`);
    }
    const groupId = randomUUID();
    const common = { ledgerId, date: input.date, month: toMonth(input.date), kind: 'transfer' as const, groupId };
    await db.insert(bucketMovements).values([
      { ...common, bucketId: from.id, amountCents: -input.amountCents, note: input.note || `A ${to.name}` },
      { ...common, bucketId: to.id, amountCents: input.amountCents, note: input.note || `Desde ${from.name}` },
    ]);
    return c.body(null, 204);
  })

  // Solo se borran movimientos hechos a mano; los del cierre se deshacen reabriendo el mes.
  .delete('/:id', async (c) => {
    const ledgerId = c.get('ledgerId');
    const [movement] = await db
      .select({ id: bucketMovements.id, kind: bucketMovements.kind, groupId: bucketMovements.groupId })
      .from(bucketMovements)
      .where(and(eq(bucketMovements.id, paramId(c)), eq(bucketMovements.ledgerId, ledgerId)));
    if (!movement) notFound('Movimiento');
    if (!['initial', 'manual', 'transfer'].includes(movement.kind)) {
      throw new HttpError(400, 'Este movimiento es del cierre de un mes: reabre el mes para deshacerlo');
    }
    await db
      .delete(bucketMovements)
      .where(movement.groupId ? eq(bucketMovements.groupId, movement.groupId) : eq(bucketMovements.id, movement.id));
    return c.body(null, 204);
  });

// Reexportados para el cierre de mes.
export { loadBuckets, syncProvisionBuckets };
