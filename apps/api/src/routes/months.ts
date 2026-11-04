import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { CLOSE_MOVEMENT_KINDS, monthBounds, monthCloseInputSchema, monthSchema } from '@contapp/shared';
import { db } from '../db/client.ts';
import { bucketMovements, buckets, monthCloses } from '../db/schema.ts';
import { HttpError, type LedgerEnv, parseJson } from '../http.ts';

const closeColumns = {
  month: monthCloses.month,
  closedAt: monthCloses.closedAt,
  incomeCents: monthCloses.incomeCents,
  needsCents: monthCloses.needsCents,
  wantsCents: monthCloses.wantsCents,
  savingsCents: monthCloses.savingsCents,
};

function parseMonthParam(value: string | undefined): string {
  const month = monthSchema.safeParse(value);
  if (!month.success) throw new HttpError(400, 'Mes no válido');
  return month.data;
}

export const monthRoutes = new Hono<LedgerEnv>()
  // Meses cerrados, del más reciente al más antiguo.
  .get('/', async (c) => {
    const rows = await db
      .select(closeColumns)
      .from(monthCloses)
      .where(eq(monthCloses.ledgerId, c.get('ledgerId')))
      .orderBy(desc(monthCloses.month));
    return c.json(rows);
  })

  // Cierra el mes: guarda los movimientos propuestos (calculados en el cliente con @contapp/shared) y la foto del medidor.
  .post('/:month/close', async (c) => {
    const ledgerId = c.get('ledgerId');
    const month = parseMonthParam(c.req.param('month'));
    const input = await parseJson(c, monthCloseInputSchema);

    const [already] = await db
      .select({ month: monthCloses.month })
      .from(monthCloses)
      .where(and(eq(monthCloses.ledgerId, ledgerId), eq(monthCloses.month, month)));
    if (already) throw new HttpError(409, 'Este mes ya está cerrado');

    const bucketIds = [...new Set(input.movements.map((m) => m.bucketId))];
    if (bucketIds.length > 0) {
      const found = await db
        .select({ id: buckets.id })
        .from(buckets)
        .where(and(eq(buckets.ledgerId, ledgerId), inArray(buckets.id, bucketIds)));
      if (found.length !== bucketIds.length) throw new HttpError(400, 'Alguna hucha del cierre no existe');
    }

    const date = monthBounds(month).end;
    await db.transaction(async (tx) => {
      if (input.movements.length > 0) {
        await tx.insert(bucketMovements).values(
          input.movements.map((m) => ({ ...m, ledgerId, date, month, affectsBudget: false })),
        );
      }
      const { movements: _, ...snapshot } = input;
      await tx.insert(monthCloses).values({ ...snapshot, ledgerId, month });
    });
    const [row] = await db
      .select(closeColumns)
      .from(monthCloses)
      .where(and(eq(monthCloses.ledgerId, ledgerId), eq(monthCloses.month, month)));
    return c.json(row, 201);
  })

  // Reabre el mes: deshace los movimientos que generó el cierre.
  .delete('/:month/close', async (c) => {
    const ledgerId = c.get('ledgerId');
    const month = parseMonthParam(c.req.param('month'));
    await db.transaction(async (tx) => {
      await tx
        .delete(bucketMovements)
        .where(
          and(
            eq(bucketMovements.ledgerId, ledgerId),
            eq(bucketMovements.month, month),
            inArray(bucketMovements.kind, [...CLOSE_MOVEMENT_KINDS]),
          ),
        );
      await tx.delete(monthCloses).where(and(eq(monthCloses.ledgerId, ledgerId), eq(monthCloses.month, month)));
    });
    return c.body(null, 204);
  });
