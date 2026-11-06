import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  type InvestmentsData,
  OPERATION_KIND_LABELS,
  investmentAccountInputSchema,
  investmentAssetInputSchema,
  investmentOperationInputSchema,
  investmentValuationInputSchema,
  isOutflow,
  toMonth,
} from '@contapp/shared';
import { db, transaction } from '../db/client.ts';
import {
  bucketMovements,
  investmentAccounts,
  investmentAssets,
  investmentOperations,
  investmentValuations,
  recurringExpenses,
} from '../db/schema.ts';
import { HttpError, type LedgerEnv, notFound, paramId, parseJson } from '../http.ts';
import { loadBuckets } from './buckets.ts';

const accountColumns = {
  id: investmentAccounts.id,
  name: investmentAccounts.name,
  archived: investmentAccounts.archived,
};

const assetColumns = {
  id: investmentAssets.id,
  accountId: investmentAssets.accountId,
  name: investmentAssets.name,
  ticker: investmentAssets.ticker,
  type: investmentAssets.type,
  assetClass: investmentAssets.assetClass,
  region: investmentAssets.region,
  archived: investmentAssets.archived,
};

const operationColumns = {
  id: investmentOperations.id,
  assetId: investmentOperations.assetId,
  date: investmentOperations.date,
  kind: investmentOperations.kind,
  amountCents: investmentOperations.amountCents,
  units: investmentOperations.units,
  source: investmentOperations.source,
  bucketId: bucketMovements.bucketId,
  recurringExpenseId: investmentOperations.recurringExpenseId,
  note: investmentOperations.note,
  createdAt: investmentOperations.createdAt,
};

const valuationColumns = {
  id: investmentValuations.id,
  assetId: investmentValuations.assetId,
  date: investmentValuations.date,
  valueCents: investmentValuations.valueCents,
};

async function loadAccount(ledgerId: number, id: number) {
  const [row] = await db
    .select(accountColumns)
    .from(investmentAccounts)
    .where(and(eq(investmentAccounts.id, id), eq(investmentAccounts.ledgerId, ledgerId)));
  return row ?? notFound('Cuenta');
}

async function loadAsset(ledgerId: number, id: number) {
  const [row] = await db
    .select(assetColumns)
    .from(investmentAssets)
    .where(and(eq(investmentAssets.id, id), eq(investmentAssets.ledgerId, ledgerId)));
  return row ?? notFound('Activo');
}

async function loadOperation(id: number) {
  const [row] = await db
    .select(operationColumns)
    .from(investmentOperations)
    .leftJoin(bucketMovements, eq(bucketMovements.id, investmentOperations.bucketMovementId))
    .where(eq(investmentOperations.id, id));
  return row!;
}

/** Cuenta activa del ámbito (para dar de alta o mover activos). */
async function assertOpenAccount(ledgerId: number, accountId: number) {
  const account = await loadAccount(ledgerId, accountId);
  if (account.archived) throw new HttpError(400, 'La cuenta está archivada');
}

export const investmentRoutes = new Hono<LedgerEnv>()
  // Todo de una vez: son pocos datos y la página y el presupuesto calculan en el cliente.
  .get('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const [accounts, assets, operations, valuations] = await Promise.all([
      db.select(accountColumns).from(investmentAccounts).where(eq(investmentAccounts.ledgerId, ledgerId)).orderBy(asc(investmentAccounts.name)),
      db.select(assetColumns).from(investmentAssets).where(eq(investmentAssets.ledgerId, ledgerId)).orderBy(asc(investmentAssets.name)),
      db
        .select(operationColumns)
        .from(investmentOperations)
        .leftJoin(bucketMovements, eq(bucketMovements.id, investmentOperations.bucketMovementId))
        .where(eq(investmentOperations.ledgerId, ledgerId))
        .orderBy(asc(investmentOperations.date), asc(investmentOperations.id)),
      db
        .select(valuationColumns)
        .from(investmentValuations)
        .where(eq(investmentValuations.ledgerId, ledgerId))
        .orderBy(asc(investmentValuations.date)),
    ]);
    return c.json({ accounts, assets, operations, valuations } satisfies InvestmentsData);
  })

  // ---- Cuentas ----

  .post('/accounts', async (c) => {
    const input = await parseJson(c, investmentAccountInputSchema);
    const [row] = await db
      .insert(investmentAccounts)
      .values({ ...input, ledgerId: c.get('ledgerId') })
      .returning(accountColumns);
    return c.json(row, 201);
  })

  .put('/accounts/:id', async (c) => {
    const account = await loadAccount(c.get('ledgerId'), paramId(c));
    const input = await parseJson(c, investmentAccountInputSchema);
    const [row] = await db
      .update(investmentAccounts)
      .set(input)
      .where(eq(investmentAccounts.id, account.id))
      .returning(accountColumns);
    return c.json(row);
  })

  // Con activos se archiva (para conservar el histórico); vacía, se borra.
  .delete('/accounts/:id', async (c) => {
    const account = await loadAccount(c.get('ledgerId'), paramId(c));
    const [hasAssets] = await db
      .select({ id: investmentAssets.id })
      .from(investmentAssets)
      .where(eq(investmentAssets.accountId, account.id))
      .limit(1);
    if (hasAssets) {
      await db.update(investmentAccounts).set({ archived: true }).where(eq(investmentAccounts.id, account.id));
      return c.json({ archived: true });
    }
    await db.delete(investmentAccounts).where(eq(investmentAccounts.id, account.id));
    return c.json({ archived: false });
  })

  .post('/accounts/:id/restore', async (c) => {
    const account = await loadAccount(c.get('ledgerId'), paramId(c));
    const [row] = await db
      .update(investmentAccounts)
      .set({ archived: false })
      .where(eq(investmentAccounts.id, account.id))
      .returning(accountColumns);
    return c.json(row);
  })

  // ---- Activos ----

  .post('/assets', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, investmentAssetInputSchema);
    await assertOpenAccount(ledgerId, input.accountId);
    const [row] = await db
      .insert(investmentAssets)
      .values({ ...input, ledgerId })
      .returning(assetColumns);
    return c.json(row, 201);
  })

  .put('/assets/:id', async (c) => {
    const ledgerId = c.get('ledgerId');
    const asset = await loadAsset(ledgerId, paramId(c));
    const input = await parseJson(c, investmentAssetInputSchema);
    if (input.accountId !== asset.accountId) await assertOpenAccount(ledgerId, input.accountId);
    const [row] = await db
      .update(investmentAssets)
      .set(input)
      .where(eq(investmentAssets.id, asset.id))
      .returning(assetColumns);
    return c.json(row);
  })

  // Con historial (operaciones, valoraciones o una aportación periódica) se archiva; si no, se borra.
  .delete('/assets/:id', async (c) => {
    const asset = await loadAsset(c.get('ledgerId'), paramId(c));
    const [[op], [val], [rec]] = await Promise.all([
      db.select({ id: investmentOperations.id }).from(investmentOperations).where(eq(investmentOperations.assetId, asset.id)).limit(1),
      db.select({ id: investmentValuations.id }).from(investmentValuations).where(eq(investmentValuations.assetId, asset.id)).limit(1),
      db.select({ id: recurringExpenses.id }).from(recurringExpenses).where(eq(recurringExpenses.investmentAssetId, asset.id)).limit(1),
    ]);
    if (op || val || rec) {
      await db.update(investmentAssets).set({ archived: true }).where(eq(investmentAssets.id, asset.id));
      return c.json({ archived: true });
    }
    await db.delete(investmentAssets).where(eq(investmentAssets.id, asset.id));
    return c.json({ archived: false });
  })

  .post('/assets/:id/restore', async (c) => {
    const ledgerId = c.get('ledgerId');
    const asset = await loadAsset(ledgerId, paramId(c));
    await assertOpenAccount(ledgerId, asset.accountId);
    const [row] = await db
      .update(investmentAssets)
      .set({ archived: false })
      .where(eq(investmentAssets.id, asset.id))
      .returning(assetColumns);
    return c.json(row);
  })

  // ---- Operaciones ----

  .post('/operations', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, investmentOperationInputSchema);
    const asset = await loadAsset(ledgerId, input.assetId);
    if (asset.archived) throw new HttpError(400, 'El activo está archivado');

    // Si el dinero sale de (o va a) una hucha, se crea su movimiento en ella.
    let movement: typeof bucketMovements.$inferInsert | null = null;
    if (input.source === 'bucket') {
      const [bucket] = await loadBuckets(ledgerId, { id: input.bucketId! });
      if (!bucket) notFound('Hucha');
      if (bucket.archived) throw new HttpError(400, 'La hucha está archivada');
      if (bucket.type === 'provision') throw new HttpError(400, 'Las huchas de provisión no se usan para invertir');
      const outflow = isOutflow(input.kind);
      if (outflow && bucket.balanceCents < input.amountCents) {
        throw new HttpError(400, `No hay tanto dinero en «${bucket.name}» (tiene ${(bucket.balanceCents / 100).toFixed(2)} €)`);
      }
      movement = {
        ledgerId,
        bucketId: bucket.id,
        amountCents: outflow ? -input.amountCents : input.amountCents,
        date: input.date,
        month: toMonth(input.date),
        kind: 'investment',
        affectsBudget: false,
        note: `${OPERATION_KIND_LABELS[input.kind]}: ${asset.name}`,
      };
    }

    const { bucketId: _, ...values } = input;
    const id = await transaction(async (tx) => {
      let bucketMovementId: number | null = null;
      if (movement) {
        const [m] = await tx.insert(bucketMovements).values(movement).returning({ id: bucketMovements.id });
        bucketMovementId = m!.id;
      }
      const [row] = await tx
        .insert(investmentOperations)
        .values({ ...values, ledgerId, bucketMovementId })
        .returning({ id: investmentOperations.id });
      return row!.id;
    });
    return c.json(await loadOperation(id), 201);
  })

  // Borra la operación y, si movió dinero de una hucha, también ese movimiento.
  .delete('/operations/:id', async (c) => {
    const [op] = await db
      .select({ id: investmentOperations.id, bucketMovementId: investmentOperations.bucketMovementId })
      .from(investmentOperations)
      .where(and(eq(investmentOperations.id, paramId(c)), eq(investmentOperations.ledgerId, c.get('ledgerId'))));
    if (!op) notFound('Operación');
    await transaction(async (tx) => {
      await tx.delete(investmentOperations).where(eq(investmentOperations.id, op.id));
      if (op.bucketMovementId !== null) {
        await tx.delete(bucketMovements).where(eq(bucketMovements.id, op.bucketMovementId));
      }
    });
    return c.body(null, 204);
  })

  // ---- Valoraciones ----

  // Una por activo y día: si ya hay una ese día, se sustituye.
  .post('/valuations', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, investmentValuationInputSchema);
    await loadAsset(ledgerId, input.assetId);
    const [row] = await db
      .insert(investmentValuations)
      .values({ ...input, ledgerId })
      .onConflictDoUpdate({
        target: [investmentValuations.assetId, investmentValuations.date],
        set: { valueCents: input.valueCents },
      })
      .returning(valuationColumns);
    return c.json(row, 201);
  })

  .delete('/valuations/:id', async (c) => {
    const [row] = await db
      .delete(investmentValuations)
      .where(and(eq(investmentValuations.id, paramId(c)), eq(investmentValuations.ledgerId, c.get('ledgerId'))))
      .returning({ id: investmentValuations.id });
    if (!row) notFound('Valoración');
    return c.body(null, 204);
  });
