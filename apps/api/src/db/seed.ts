import { db } from './client.ts';
import { categories, ledgers } from './schema.ts';

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

/** Crea el ámbito Personal y las categorías por defecto si la BD está vacía. */
export async function seedIfEmpty() {
  const existing = await db.select({ id: ledgers.id }).from(ledgers).limit(1);
  if (existing.length > 0) return;

  const [personal] = await db
    .insert(ledgers)
    .values({ name: 'Personal', kind: 'personal' })
    .returning({ id: ledgers.id });

  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, ledgerId: personal!.id })));
  console.log('Datos iniciales creados');
}
