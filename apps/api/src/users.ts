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

/** Guarda el email y el nombre que trae el IdP en cada login (pueden cambiar; el sub no). */
export async function updateProfile(userId: number, identity: Identity): Promise<void> {
  await db
    .update(users)
    .set({ email: identity.email ?? null, name: identity.name ?? null })
    .where(eq(users.id, userId));
}

/** El usuario provisional dueño de los datos de antes del multiusuario. */
export const LOCAL_OWNER_SUB = 'local:owner';

/**
 * Pasa los datos de local:owner a tu usuario real del IdP, cambiando su sub. Se hace una vez,
 * ANTES de tu primer login: si ya entraste, el alta automática te creó otro usuario (vacío)
 * con ese sub, y no se fusionan dos usuarios a ciegas.
 */
export async function linkLocalOwner(realSub: string): Promise<void> {
  const sub = realSub.trim();
  if (!sub || sub === LOCAL_OWNER_SUB) throw new Error('Indica el sub de tu usuario en el IdP');

  await transaction(async (tx) => {
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.sub, LOCAL_OWNER_SUB));
    if (!owner) throw new Error(`No existe ${LOCAL_OWNER_SUB}: o ya está enlazado o la BD es nueva`);

    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.sub, sub));
    if (taken) {
      throw new Error(
        `Ya existe un usuario con el sub ${sub} (seguramente iniciaste sesión antes de enlazar). ` +
          'No se fusionan usuarios automáticamente: revisa la BD a mano.',
      );
    }
    await tx.update(users).set({ sub }).where(eq(users.id, owner.id));
  });
}

async function findUser(sub: string) {
  const [user] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.sub, sub));
  return user;
}
