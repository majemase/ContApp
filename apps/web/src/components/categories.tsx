import type { Category } from '@contapp/shared';
import { cx } from './ui';

// Clases completas (Tailwind solo genera las que aparecen literalmente en el código).
export const CATEGORY_COLORS: Record<string, { chip: string; swatch: string }> = {
  slate: { chip: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200', swatch: 'bg-slate-500' },
  stone: { chip: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200', swatch: 'bg-stone-500' },
  amber: { chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200', swatch: 'bg-amber-500' },
  orange: { chip: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200', swatch: 'bg-orange-500' },
  rose: { chip: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200', swatch: 'bg-rose-500' },
  pink: { chip: 'bg-pink-100 text-pink-900 dark:bg-pink-900/40 dark:text-pink-200', swatch: 'bg-pink-500' },
  violet: { chip: 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200', swatch: 'bg-violet-500' },
  indigo: { chip: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200', swatch: 'bg-indigo-500' },
  sky: { chip: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200', swatch: 'bg-sky-500' },
  cyan: { chip: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/40 dark:text-cyan-200', swatch: 'bg-cyan-500' },
  teal: { chip: 'bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-200', swatch: 'bg-teal-500' },
  emerald: { chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200', swatch: 'bg-emerald-500' },
};

export function categoryChipClass(color: string) {
  return (CATEGORY_COLORS[color] ?? CATEGORY_COLORS.slate!).chip;
}

/** Icono de la categoría en un círculo de su color. */
export function CategoryIcon({ category, className }: { category: Category | undefined; className?: string }) {
  return (
    <span
      className={cx(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-lg',
        categoryChipClass(category?.color ?? 'slate'),
        className,
      )}
    >
      {category?.icon || '•'}
    </span>
  );
}

/** Selector de categoría como fichas pulsables (más rápido que un <select> en el móvil). */
export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((c) => {
        const selected = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(selected ? null : c.id)}
            className={cx(
              'rounded-full px-3 py-1.5 text-sm transition',
              selected
                ? 'bg-emerald-600 text-white ring-2 ring-emerald-600'
                : cx(categoryChipClass(c.color), 'opacity-80 hover:opacity-100'),
            )}
          >
            {c.icon} {c.name}
          </button>
        );
      })}
    </div>
  );
}
