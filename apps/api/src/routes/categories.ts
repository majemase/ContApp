import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { categoryInputSchema } from '@contapp/shared';
import { db } from '../db/client.ts';
import { categories, expenses, recurringExpenses } from '../db/schema.ts';
import { HttpError, type LedgerEnv, notFound, paramId, parseJson } from '../http.ts';

const columns = {
  id: categories.id,
  ledgerId: categories.ledgerId,
  name: categories.name,
  icon: categories.icon,
  color: categories.color,
  archived: categories.archived,
};

/** Comprueba que la categoría existe y pertenece al ámbito. */
export async function assertCategory(ledgerId: number, categoryId: number | null) {
  if (categoryId === null) return;
  const [found] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.ledgerId, ledgerId)));
  if (!found) throw new HttpError(400, 'La categoría no existe');
}

export const categoryRoutes = new Hono<LedgerEnv>()
  .get('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const includeArchived = c.req.query('includeArchived') === 'true';
    const rows = await db
      .select(columns)
      .from(categories)
      .where(
        includeArchived
          ? eq(categories.ledgerId, ledgerId)
          : and(eq(categories.ledgerId, ledgerId), eq(categories.archived, false)),
      )
      .orderBy(asc(categories.name));
    return c.json(rows);
  })

  .post('/', async (c) => {
    const input = await parseJson(c, categoryInputSchema);
    const [row] = await db
      .insert(categories)
      .values({ ...input, ledgerId: c.get('ledgerId') })
      .returning(columns);
    return c.json(row, 201);
  })

  .put('/:id', async (c) => {
    const input = await parseJson(c, categoryInputSchema);
    const [row] = await db
      .update(categories)
      .set(input)
      .where(and(eq(categories.id, paramId(c)), eq(categories.ledgerId, c.get('ledgerId'))))
      .returning(columns);
    return row ? c.json(row) : notFound('Categoría');
  })

  .post('/:id/restore', async (c) => {
    const [row] = await db
      .update(categories)
      .set({ archived: false })
      .where(and(eq(categories.id, paramId(c)), eq(categories.ledgerId, c.get('ledgerId'))))
      .returning(columns);
    return row ? c.json(row) : notFound('Categoría');
  })

  // Si la categoría está en uso se archiva (para no perder el histórico); si no, se borra.
  .delete('/:id', async (c) => {
    const id = paramId(c);
    const where = and(eq(categories.id, id), eq(categories.ledgerId, c.get('ledgerId')));
    const [existing] = await db.select({ id: categories.id }).from(categories).where(where);
    if (!existing) notFound('Categoría');

    const [usedByExpense] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.categoryId, id))
      .limit(1);
    const [usedByRecurring] = await db
      .select({ id: recurringExpenses.id })
      .from(recurringExpenses)
      .where(eq(recurringExpenses.categoryId, id))
      .limit(1);

    if (usedByExpense || usedByRecurring) {
      await db.update(categories).set({ archived: true }).where(where);
      return c.json({ archived: true });
    }
    await db.delete(categories).where(where);
    return c.json({ archived: false });
  });
