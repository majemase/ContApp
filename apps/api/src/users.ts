import { eq } from 'drizzle-orm';
import { db, transaction } from './db/client.ts';
import { createPersonalLedger } from './db/seed.ts';
import { users } from './db/schema.ts';
import { ensureDefaultBuckets } from './routes/buckets.ts';

export interface Identity {
  /** Identificador permanente del usuario en el IdP. */
  sub: string;
  email?: string | null;
  name?: string | null;
}

/**
 * Devuelve el usuario con ese `sub`, o lo crea con su ámbito Personal si es su primer acceso (JIT).
 * Lo usa el usuario de desarrollo y lo usará el callback del login OIDC.
 */
export async function findOrCreateUser(identity: Identity): Promise<{ id: number; active: boolean }> {
  const existing = await findUser(identity.sub);
  if (existing) return existing;

  const created = await transaction(async (tx) => {
    // Si dos peticiones llegan a la vez, solo una inserta; la otra no crea un segundo ámbito.
    const [user] = await tx
      .insert(users)
      .values({ sub: identity.sub, email: identity.email ?? null, name: identity.name ?? null })
      .onConflictDoNothing({ target: users.sub })
      .returning({ id: users.id, active: users.active });
    if (!user) return null;
    const ledgerId = await createPersonalLedger(tx, user.id);
    return { user, ledgerId };
  });

  if (!created) return (await findUser(identity.sub))!;
  await ensureDefaultBuckets(created.ledgerId);
  return created.user;
}

async function findUser(sub: string) {
  const [user] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.sub, sub));
  return user;
}
