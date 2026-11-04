import { and, between, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type ExpenseInput, expenseInputSchema, monthBounds, monthSchema } from '@contapp/shared';
import { db } from '../db/client.ts';
import { expenses, recurringExpenses } from '../db/schema.ts';
import { HttpError, type LedgerEnv, notFound, paramId, parseJson } from '../http.ts';
import { assertCategory } from './categories.ts';

const columns = {
  id: expenses.id,
  ledgerId: expenses.ledgerId,
  categoryId: expenses.categoryId,
  date: expenses.date,
  amountCents: expenses.amountCents,
  note: expenses.note,
  impulsive: expenses.impulsive,
  recurringExpenseId: expenses.recurringExpenseId,
  createdAt: expenses.createdAt,
};

async function assertRefs(ledgerId: number, input: Required<Pick<ExpenseInput, 'categoryId' | 'recurringExpenseId'>>) {
  await assertCategory(ledgerId, input.categoryId);
  if (input.recurringExpenseId !== null) {
    const [found] = await db
      .select({ id: recurringExpenses.id })
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.id, input.recurringExpenseId), eq(recurringExpenses.ledgerId, ledgerId)));
    if (!found) throw new HttpError(400, 'El gasto recurrente no existe');
  }
}

export const expenseRoutes = new Hono<LedgerEnv>()
  // GET /expenses?month=2026-11
  .get('/', async (c) => {
    const month = monthSchema.safeParse(c.req.query('month'));
    if (!month.success) throw new HttpError(400, 'Indica el mes (?month=YYYY-MM)');
    const { start, end } = monthBounds(month.data);
    const rows = await db
      .select(columns)
      .from(expenses)
      .where(and(eq(expenses.ledgerId, c.get('ledgerId')), between(expenses.date, start, end)))
      .orderBy(desc(expenses.date), desc(expenses.id));
    return c.json(rows);
  })

  .post('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, expenseInputSchema);
    await assertRefs(ledgerId, input);
    const [row] = await db
      .insert(expenses)
      .values({ ...input, ledgerId })
      .returning(columns);
    return c.json(row, 201);
  })

  .put('/:id', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, expenseInputSchema);
    await assertRefs(ledgerId, input);
    const [row] = await db
      .update(expenses)
      .set(input)
      .where(and(eq(expenses.id, paramId(c)), eq(expenses.ledgerId, ledgerId)))
      .returning(columns);
    return row ? c.json(row) : notFound('Gasto');
  })

  .delete('/:id', async (c) => {
    const [row] = await db
      .delete(expenses)
      .where(and(eq(expenses.id, paramId(c)), eq(expenses.ledgerId, c.get('ledgerId'))))
      .returning({ id: expenses.id });
    return row ? c.body(null, 204) : notFound('Gasto');
  });
