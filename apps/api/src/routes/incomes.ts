import { and, between, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { incomeInputSchema, monthBounds, monthSchema } from '@contapp/shared';
import { db } from '../db/client.ts';
import { incomes } from '../db/schema.ts';
import { HttpError, type LedgerEnv, notFound, paramId, parseJson } from '../http.ts';

const columns = {
  id: incomes.id,
  ledgerId: incomes.ledgerId,
  date: incomes.date,
  amountCents: incomes.amountCents,
  type: incomes.type,
  note: incomes.note,
  createdAt: incomes.createdAt,
};

export const incomeRoutes = new Hono<LedgerEnv>()
  // GET /incomes?month=2026-11
  .get('/', async (c) => {
    const month = monthSchema.safeParse(c.req.query('month'));
    if (!month.success) throw new HttpError(400, 'Indica el mes (?month=YYYY-MM)');
    const { start, end } = monthBounds(month.data);
    const rows = await db
      .select(columns)
      .from(incomes)
      .where(and(eq(incomes.ledgerId, c.get('ledgerId')), between(incomes.date, start, end)))
      .orderBy(desc(incomes.date), desc(incomes.id));
    return c.json(rows);
  })

  .post('/', async (c) => {
    const input = await parseJson(c, incomeInputSchema);
    const [row] = await db
      .insert(incomes)
      .values({ ...input, ledgerId: c.get('ledgerId') })
      .returning(columns);
    return c.json(row, 201);
  })

  .put('/:id', async (c) => {
    const input = await parseJson(c, incomeInputSchema);
    const [row] = await db
      .update(incomes)
      .set(input)
      .where(and(eq(incomes.id, paramId(c)), eq(incomes.ledgerId, c.get('ledgerId'))))
      .returning(columns);
    return row ? c.json(row) : notFound('Ingreso');
  })

  .delete('/:id', async (c) => {
    const [row] = await db
      .delete(incomes)
      .where(and(eq(incomes.id, paramId(c)), eq(incomes.ledgerId, c.get('ledgerId'))))
      .returning({ id: incomes.id });
    return row ? c.body(null, 204) : notFound('Ingreso');
  });
