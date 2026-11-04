import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import {
  SAVINGS_MODES,
  SAVINGS_MODE_LABELS,
  type SavingsMode,
  type Settings,
  centsToInput,
  commitmentSummary,
  currentMonth,
  formatEuros,
  monthlySavings,
  parseEuros,
} from '@contapp/shared';
import { useRecurring, useSettings, useUpdateSettings } from '../api';
import { useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Field, Input, MoneyInput, PageHeader, cx } from '../components/ui';

export function SettingsPage() {
  const query = useSettings();

  return (
    <>
      <PageHeader title="Ajustes" />

      {query.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : query.error ? (
        <ErrorText error={query.error} />
      ) : (
        <Card>
          <SettingsForm settings={query.data} />
        </Card>
      )}

      <Card className="p-0">
        <Link
          to="/ajustes/categorias"
          className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        >
          <span className="text-xl">🏷️</span>
          <span className="flex-1 font-medium">Categorías</span>
          <span className="text-slate-400">›</span>
        </Link>
      </Card>
    </>
  );
}

const SAVINGS_HELP: Record<SavingsMode, string> = {
  fixed: 'La misma cantidad todos los meses.',
  percent: 'Un porcentaje de tu ingreso de referencia (o de lo cobrado, si un mes cobras menos).',
  max: 'El porcentaje, pero nunca menos del mínimo. Los meses buenos ahorras más y los malos tienes un suelo.',
};

function SettingsForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const recurring = useRecurring();
  const toast = useToast();
  const [reference, setReference] = useState(
    settings.referenceIncomeCents !== null ? centsToInput(settings.referenceIncomeCents) : '',
  );
  const [savingsMode, setSavingsMode] = useState<SavingsMode>(settings.savingsMode);
  const [minSavings, setMinSavings] = useState(centsToInput(settings.minSavingsCents));
  const [savingsPct, setSavingsPct] = useState(String(settings.savingsPct));
  const [threshold, setThreshold] = useState(String(settings.healthThresholdPct));
  const [localError, setLocalError] = useState<string | null>(null);

  const usesFixed = savingsMode !== 'percent';
  const usesPct = savingsMode !== 'fixed';

  // Vista previa con lo que hay escrito ahora mismo en el formulario.
  const previewSettings: Settings = {
    referenceIncomeCents: reference.trim() === '' ? null : parseEuros(reference),
    savingsMode,
    minSavingsCents: parseEuros(minSavings) ?? 0,
    savingsPct: Math.min(100, Math.max(0, Number(savingsPct) || 0)),
    healthThresholdPct: Number(threshold) || 70,
  };
  const committed = recurring.data ? commitmentSummary(recurring.data, currentMonth()).total : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const referenceIncomeCents = reference.trim() === '' ? null : parseEuros(reference);
    const minSavingsCents = !usesFixed || minSavings.trim() === '' ? 0 : parseEuros(minSavings);
    const pct = usesPct ? Number(savingsPct) : 0;
    const healthThresholdPct = Number(threshold);

    if (reference.trim() !== '' && (referenceIncomeCents === null || referenceIncomeCents <= 0)) {
      return setLocalError('El ingreso de referencia no es válido');
    }
    if (minSavingsCents === null || minSavingsCents < 0) return setLocalError('El importe de ahorro no es válido');
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      return setLocalError('El porcentaje de ahorro debe estar entre 0 y 100');
    }
    if (!Number.isInteger(healthThresholdPct) || healthThresholdPct < 1 || healthThresholdPct > 100) {
      return setLocalError('El umbral debe estar entre 1 y 100');
    }
    setLocalError(null);
    try {
      await update.mutateAsync({ referenceIncomeCents, savingsMode, minSavingsCents, savingsPct: pct, healthThresholdPct });
      toast({ message: 'Ajustes guardados', tone: 'success' });
    } catch {
      // El error se muestra desde la mutación.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Field
        label="Ingreso de referencia"
        hint={
          <>
            Lo que cobras <strong>seguro</strong> cualquier mes, incluso en verano sin dietas. El mes se presupuesta
            con esta cifra; lo que cobres por encima es <em>extra</em> y no cuenta como dinero para gastar. Si lo
            dejas vacío, se usa todo lo cobrado.
          </>
        }
      >
        <MoneyInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="1.000,00" />
      </Field>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Ahorro mensual</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {SAVINGS_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSavingsMode(m)}
              aria-pressed={savingsMode === m}
              className={cx(
                'rounded-md px-2 py-1.5 text-sm font-medium',
                savingsMode === m ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {SAVINGS_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{SAVINGS_HELP[savingsMode]}</p>

        <div className="flex gap-3">
          {usesPct && (
            <div className="w-32 shrink-0">
              <Field label="Porcentaje">
                <PercentInput value={savingsPct} onChange={setSavingsPct} min={0} />
              </Field>
            </div>
          )}
          {usesFixed && (
            <div className="min-w-0 flex-1">
              <Field label={savingsMode === 'max' ? 'Mínimo' : 'Importe'}>
                <MoneyInput value={minSavings} onChange={(e) => setMinSavings(e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <SavingsPreview settings={previewSettings} committed={committed} />
      </fieldset>

      <Field
        label="Aviso de salud del presupuesto (%)"
        hint="Te avisa si tus gastos comprometidos más el ahorro superan este porcentaje del ingreso de referencia. Un 70 % deja margen para el día a día."
      >
        <div className="w-32">
          <PercentInput value={threshold} onChange={setThreshold} min={1} />
        </div>
      </Field>

      {localError && <p className="text-sm text-rose-600">{localError}</p>}
      <ErrorText error={update.error} />
      <Button type="submit" disabled={update.isPending} className="w-full py-2.5">
        {update.isPending ? 'Guardando…' : 'Guardar ajustes'}
      </Button>
    </form>
  );
}

/** Cuánto se ahorraría y cuánto quedaría para el día a día con los valores del formulario. */
function SavingsPreview({ settings, committed }: { settings: Settings; committed: number | null }) {
  const base = settings.referenceIncomeCents;
  if (base === null) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        Pon un ingreso de referencia para ver cuánto ahorrarías.
      </p>
    );
  }
  const savings = monthlySavings(settings, base);
  const left = committed === null ? null : base - committed - savings;
  const negative = left !== null && left < 0;

  return (
    <div className="grid grid-cols-2 gap-2 text-center">
      <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/40">
        <p className="text-xs text-slate-500 dark:text-slate-400">Ahorras al mes</p>
        <p className="font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">{formatEuros(savings)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {Math.round((savings / base) * 100)} % de la referencia
        </p>
      </div>
      <div className={cx('rounded-lg px-3 py-2', negative ? 'bg-rose-50 dark:bg-rose-950/40' : 'bg-slate-50 dark:bg-slate-800/60')}>
        <p className="text-xs text-slate-500 dark:text-slate-400">Para el día a día</p>
        <p className={cx('font-semibold tabular-nums', negative && 'text-rose-600 dark:text-rose-400')}>
          {left === null ? '…' : formatEuros(left)}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">tras fijos y presupuestos</p>
      </div>
    </div>
  );
}

function PercentInput({ value, onChange, min }: { value: string; onChange: (v: string) => void; min: number }) {
  return (
    <div className="relative">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={100}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-8"
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
        %
      </span>
    </div>
  );
}
