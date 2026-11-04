import { formatEuros } from '@contapp/shared';
import { cx } from './ui';

export interface MeterValues {
  income: number;
  needs: number;
  wants: number;
  savings: number;
}

export interface MeterTargets {
  needs: number;
  wants: number;
  savings: number;
}

const ROWS = [
  { key: 'needs', label: 'Necesidades', color: 'bg-sky-500', higherIsBetter: false },
  { key: 'wants', label: 'Deseos', color: 'bg-violet-500', higherIsBetter: false },
  { key: 'savings', label: 'Ahorro', color: 'bg-emerald-500', higherIsBetter: true },
] as const;

/** Reparto real (necesidades / deseos / ahorro) frente al objetivo. */
export function Meter({ values, targets }: { values: MeterValues; targets: MeterTargets }) {
  if (values.income <= 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Apunta tus ingresos para ver el reparto.</p>;
  }
  const pct = (v: number) => Math.round((v / values.income) * 100);

  return (
    <div className="space-y-3">
      {/* Barra apilada con el reparto real */}
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {ROWS.map((r) => (
          <div
            key={r.key}
            className={r.color}
            style={{ width: `${Math.max(0, Math.min(100, pct(values[r.key])))}%` }}
          />
        ))}
      </div>

      <ul className="space-y-1.5 text-sm">
        {ROWS.map((r) => {
          const actual = pct(values[r.key]);
          const target = targets[r.key];
          const ok = r.higherIsBetter ? actual >= target : actual <= target;
          return (
            <li key={r.key} className="flex items-center gap-2">
              <span className={cx('size-2.5 shrink-0 rounded-full', r.color)} />
              <span className="flex-1">{r.label}</span>
              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {formatEuros(values[r.key])}
              </span>
              <span
                className={cx(
                  'w-24 text-right font-semibold tabular-nums',
                  ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {actual} %<span className="font-normal text-slate-400"> / {target} %</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
