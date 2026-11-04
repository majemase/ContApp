import { Link } from 'react-router';
import { type MonthClose, formatEuros, parseMonth } from '@contapp/shared';
import { Card, cx } from './ui';

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortLabel(month: string) {
  const { year, month: m } = parseMonth(month);
  return `${SHORT_MONTHS[m - 1]} ${String(year).slice(2)}`;
}

const pct = (value: number, income: number) => (income > 0 ? Math.round((value / income) * 100) : 0);

/** Reparto de los últimos meses cerrados (necesidades / deseos / ahorro) y el % ahorrado. */
export function MonthsHistory({ closes, targetSavingsPct }: { closes: MonthClose[]; targetSavingsPct: number }) {
  const months = closes.slice(0, 12);
  if (months.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cuando cierres tu primer mes verás aquí cómo evoluciona tu reparto.
        </p>
      </Card>
    );
  }

  const totalIncome = months.reduce((s, c) => s + c.incomeCents, 0);
  const totalSaved = months.reduce((s, c) => s + c.savingsCents, 0);
  const avgSavingsPct = pct(totalSaved, totalIncome);

  return (
    <Card className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">Ahorro medio</p>
          <p
            className={cx(
              'text-xl font-semibold tabular-nums',
              avgSavingsPct >= targetSavingsPct ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
            )}
          >
            {avgSavingsPct} %
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">objetivo {targetSavingsPct} %</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ahorrado en {months.length} {months.length === 1 ? 'mes' : 'meses'}
          </p>
          <p className="text-xl font-semibold tabular-nums">{formatEuros(totalSaved)}</p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {months.map((c) => {
          const n = Math.max(0, pct(c.needsCents, c.incomeCents));
          const w = Math.max(0, pct(c.wantsCents, c.incomeCents));
          const s = pct(c.savingsCents, c.incomeCents);
          return (
            <li key={c.month}>
              <Link to={`/cerrar/${c.month}`} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {shortLabel(c.month)}
                </span>
                <div className="relative flex h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="bg-sky-500" style={{ width: `${Math.min(100, n)}%` }} />
                  <div className="bg-violet-500" style={{ width: `${Math.min(100 - Math.min(100, n), w)}%` }} />
                  <div className="bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100 - n - w, s))}%` }} />
                  {/* Marca del objetivo de ahorro, medida desde la derecha */}
                  <div
                    className="absolute inset-y-0 w-0.5 bg-slate-900/50 dark:bg-white/60"
                    style={{ right: `${targetSavingsPct}%` }}
                    title={`Objetivo de ahorro: ${targetSavingsPct} %`}
                  />
                </div>
                <span
                  className={cx(
                    'w-12 shrink-0 text-right text-sm font-semibold tabular-nums',
                    s >= targetSavingsPct ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {s} %
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-sky-500" />
          Necesidades
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-violet-500" />
          Deseos
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />
          Ahorro
        </span>
        <span>▏ objetivo de ahorro</span>
      </div>
    </Card>
  );
}
