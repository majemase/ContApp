import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  amountChangeSchema,
  type RecurringExpense,
  recurringCreateSchema,
  recurringUpdateSchema,
} from '@contapp/shared';
import { db } from '../db/client.ts';
import { recurringExpenseAmounts, recurringExpenses } from '../db/schema.ts';
import { HttpError, type LedgerEnv, notFound, paramId, parseJson } from '../http.ts';
import { assertCategory } from './categories.ts';

/** Carga los recurrentes del ámbito (o uno concreto) con su historial de importes. */
async function loadRecurring(ledgerId: number, id?: number): Promise<RecurringExpense[]> {
  const rows = await db
    .select()
    .from(recurringExpenses)
    .where(
      id === undefined
        ? eq(recurringExpenses.ledgerId, ledgerId)
        : and(eq(recurringExpenses.ledgerId, ledgerId), eq(recurringExpenses.id, id)),
    )
    .orderBy(asc(recurringExpenses.name));
  if (rows.length === 0) return [];

  const amounts = await db
    .select()
    .from(recurringExpenseAmounts)
    .where(
      inArray(
        recurringExpenseAmounts.recurringExpenseId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(recurringExpenseAmounts.validFrom));

  return rows.map(({ createdAt: _, ...r }) => ({
    ...r,
    amounts: amounts
      .filter((a) => a.recurringExpenseId === r.id)
      .map(({ id, amountCents, validFrom }) => ({ id, amountCents, validFrom })),
  }));
}

async function loadOne(ledgerId: number, id: number): Promise<RecurringExpense> {
  const [r] = await loadRecurring(ledgerId, id);
  return r ?? notFound('Gasto recurrente');
}

export const recurringRoutes = new Hono<LedgerEnv>()
  .get('/', async (c) => c.json(await loadRecurring(c.get('ledgerId'))))

  .get('/:id', async (c) => c.json(await loadOne(c.get('ledgerId'), paramId(c))))

  .post('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const { amountCents, ...input } = await parseJson(c, recurringCreateSchema);
    await assertCategory(ledgerId, input.categoryId);

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(recurringExpenses)
        .values({ ...input, ledgerId })
        .returning({ id: recurringExpenses.id });
      await tx
        .insert(recurringExpenseAmounts)
        .values({ recurringExpenseId: row!.id, amountCents, validFrom: input.startDate });
      return row!.id;
    });
    return c.json(await loadOne(ledgerId, id), 201);
  })

  .put('/:id', async (c) => {
    const ledgerId = c.get('ledgerId');
    const current = await loadOne(ledgerId, paramId(c));
    const input = await parseJson(c, recurringUpdateSchema);
    await assertCategory(ledgerId, input.categoryId);

    await db.transaction(async (tx) => {
      await tx.update(recurringExpenses).set(input).where(eq(recurringExpenses.id, current.id));
      // Si se adelanta el inicio, el primer importe debe aplicar desde el nuevo inicio.
      const first = current.amounts[0];
      if (first && input.startDate < first.validFrom) {
        await tx
          .update(recurringExpenseAmounts)
          .set({ validFrom: input.startDate })
          .where(eq(recurringExpenseAmounts.id, first.id));
      }
    });
    return c.json(await loadOne(ledgerId, current.id));
  })

  .delete('/:id', async (c) => {
    const current = await loadOne(c.get('ledgerId'), paramId(c));
    await db.delete(recurringExpenses).where(eq(recurringExpenses.id, current.id));
    return c.body(null, 204);
  })

  // Nuevo importe a partir de una fecha (p. ej. fin de la tarifa plana). Si ya hay uno en esa fecha, se sustituye.
  .post('/:id/amounts', async (c) => {
    const ledgerId = c.get('ledgerId');
    const current = await loadOne(ledgerId, paramId(c));
    const input = await parseJson(c, amountChangeSchema);
    await db
      .insert(recurringExpenseAmounts)
      .values({ ...input, recurringExpenseId: current.id })
      .onConflictDoUpdate({
        target: [recurringExpenseAmounts.recurringExpenseId, recurringExpenseAmounts.validFrom],
        set: { amountCents: input.amountCents },
      });
    return c.json(await loadOne(ledgerId, current.id), 201);
  })

  .delete('/:id/amounts/:amountId', async (c) => {
    const ledgerId = c.get('ledgerId');
    const current = await loadOne(ledgerId, paramId(c));
    const amountId = paramId(c, 'amountId');
    if (!current.amounts.some((a) => a.id === amountId)) notFound('Importe');
    if (current.amounts.length === 1) {
      throw new HttpError(400, 'Un gasto recurrente necesita al menos un importe');
    }
    await db.delete(recurringExpenseAmounts).where(eq(recurringExpenseAmounts.id, amountId));
    return c.json(await loadOne(ledgerId, current.id));
  });
