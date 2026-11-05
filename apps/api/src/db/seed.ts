import type { Tx } from './client.ts';
import { categories, ledgerMembers, ledgers } from './schema.ts';

const DEFAULT_CATEGORIES: { name: string; icon: string; color: string }[] = [
  { name: 'Casa', icon: '🏠', color: 'amber' },
  { name: 'Transporte', icon: '⛽', color: 'sky' },
  { name: 'Supermercado', icon: '🛒', color: 'emerald' },
  { name: 'Desayunos y cafés', icon: '☕', color: 'orange' },
  { name: 'Restaurantes', icon: '🍽️', color: 'rose' },
  { name: 'Ocio', icon: '🎉', color: 'violet' },
  { name: 'Compras', icon: '🛍️', color: 'pink' },
  { name: 'Salud', icon: '💊', color: 'teal' },
  { name: 'Suscripciones', icon: '📺', color: 'indigo' },
  { name: 'Seguros', icon: '🛡️', color: 'cyan' },
  { name: 'Autónomo e impuestos', icon: '💼', color: 'stone' },
  { name: 'Otros', icon: '📦', color: 'slate' },
];

/**
 * Crea un ámbito Personal con las categorías por defecto y hace al usuario su owner.
 * Las huchas por defecto las pone ensureDefaultBuckets, fuera de la transacción.
 */
export async function createPersonalLedger(tx: Tx, userId: number): Promise<number> {
  const [ledger] = await tx
    .insert(ledgers)
    .values({ name: 'Personal', kind: 'personal' })
    .returning({ id: ledgers.id });
  const ledgerId = ledger!.id;

  await tx.insert(ledgerMembers).values({ userId, ledgerId, role: 'owner' });
  await tx.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, ledgerId })));
  return ledgerId;
}
