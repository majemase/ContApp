import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { idSchema, type LedgerRole } from '@contapp/shared';

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

/** Rutas con usuario identificado (lo pone el middleware currentUser). */
export type AuthEnv = { Variables: { userId: number } };

/** Rutas de un ámbito: además del usuario, el ámbito y su rol en él. */
export type LedgerEnv = { Variables: { userId: number; ledgerId: number; role: LedgerRole } };

/** Lee y valida el body JSON. Lanza 400 con los errores de validación. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const body: unknown = await c.req.json().catch(() => {
    throw new HttpError(400, 'El cuerpo de la petición no es JSON válido');
  });
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, first?.message ?? 'Datos no válidos', result.error.issues);
  }
  return result.data;
}

export function paramId(c: Context, name = 'id'): number {
  const result = idSchema.safeParse(c.req.param(name));
  if (!result.success) throw new HttpError(400, `Parámetro ${name} no válido`);
  return result.data;
}

export function notFound(what: string): never {
  throw new HttpError(404, `${what} no encontrado`);
}
