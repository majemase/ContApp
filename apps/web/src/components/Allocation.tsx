import { useState } from 'react';
import { formatEuros } from '@contapp/shared';
import { cx } from './ui';

/** Hay 8 colores de serie; a partir del 8.º, lo demás se agrupa en «Otros». */
export const SERIES_COUNT = 8;

export interface Slice {
  key: string | number;
  label: string;
  value: number;
  pct: number;
  /** Posición fija de la entidad (0-7) para que su color no cambie. Null = «Otros». */
  colorIndex: number | null;
}

const colorOf = (s: Slice) => (s.colorIndex === null ? 'var(--series-other)' : `var(--series-${s.colorIndex + 1})`);

/**
 * Reparto de un total: una barra apilada y, debajo, la lista con nombre, % e importe
 * (hace de leyenda y de tabla, así la identidad nunca depende solo del color).
 * Al pasar por un segmento (o tocarlo) se resalta su fila y se atenúa el resto.
 */
export function AllocationChart({ slices }: { slices: Slice[] }) {
  const [active, setActive] = useState<Slice['key'] | null>(null);

  if (slices.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">Aún no hay nada que repartir.</p>;
  }

  return (
    <div className="space-y-3">
      {/* El hueco de 2 px entre segmentos deja ver la tarjeta y separa los colores. */}
      <div className="flex h-4 gap-[2px]" role="img" aria-label="Reparto de la cartera">
        {slices.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-label={`${s.label}: ${formatPct(s.pct)}`}
            className={cx(
              'h-full min-w-[3px] rounded-[4px] transition-opacity',
              active !== null && active !== s.key && 'opacity-40',
            )}
            style={{ flexGrow: s.value, flexBasis: 0, backgroundColor: colorOf(s) }}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(s.key)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(active === s.key ? null : s.key)}
          />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {slices.map((s) => (
          <li
            key={s.key}
            className={cx('flex items-center gap-2 transition-opacity', active !== null && active !== s.key && 'opacity-50')}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: colorOf(s) }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="w-14 text-right text-slate-500 tabular-nums dark:text-slate-400">{formatPct(s.pct)}</span>
            <span className="w-24 text-right font-medium tabular-nums">{formatEuros(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function formatPct(pct: number): string {
  return `${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
}
