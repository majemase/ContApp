import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import {
  type Bucket,
  type ExtraRule,
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
import { useBuckets, useRecurring, useSettings, useUpdateSettings } from '../api';
import { useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Field, Input, MoneyInput, PageHeader, Select, cx } from '../components/ui';

export function SettingsPage() {
  const query = useSettings();
  const buckets = useBuckets();
  const savingBuckets = (buckets.data ?? []).filter((b) => b.type !== 'provision');

  return (
    <>
      <PageHeader title="Ajustes" />

      <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
        <NavRow to="/ajustes/recurrentes" icon="🔁" label="Gastos recurrentes" hint="Casa, seguros, cuota, presupuestos…" />
        <NavRow to="/ajustes/categorias" icon="🏷️" label="Categorías" />
      </Card>

      {query.isPending || buckets.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : query.error ? (
        <ErrorText error={query.error} />
      ) : (
        <>
          <SettingsCard title="Presupuesto del mes">
            <BudgetForm settings={query.data} buckets={savingBuckets} />
          </SettingsCard>
          <SettingsCard
            title="Reparto del extra"
            description="Lo que cobras por encima de tu referencia (dietas, pagas…). La parte libre se suma a lo que puedes gastar ese mes; el resto va a las huchas al cerrar el mes."
          >
            <RulesForm settings={query.data} buckets={savingBuckets} field="extraRules" />
          </SettingsCard>
          <SettingsCard
            title="Reparto de ingresos puntuales"
            description="Atrasos y devoluciones (Hacienda…): dinero que no se repite. Puedes darle un reparto distinto, por ejemplo casi todo al ahorro."
          >
            <RulesForm settings={query.data} buckets={savingBuckets} field="oneOffRules" />
          </SettingsCard>
          <SettingsCard
            title="Objetivo de reparto"
            description="Cómo te gustaría repartir lo que cobras. El resumen y el cierre de mes comparan tu reparto real con este objetivo."
          >
            <TargetsForm settings={query.data} />
          </SettingsCard>
        </>
      )}
    </>
  );
}

function NavRow({ to, icon, label, hint }: { to: string; icon: string; label: string; hint?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <span className="text-xl">{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
      <span className="text-slate-400">›</span>
    </Link>
  );
}

function SettingsCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Guarda una parte de los ajustes manteniendo el resto. */
function useSaveSettings(settings: Settings) {
  const update = useUpdateSettings();
  const toast = useToast();
  return {
    update,
    save: async (partial: Partial<Settings>) => {
      try {
        await update.mutateAsync({ ...settings, ...partial });
        toast({ message: 'Ajustes guardados', tone: 'success' });
      } catch {
        // El error se muestra desde la mutación.
      }
    },
  };
}

// ---- Presupuesto del mes ----

const SAVINGS_HELP: Record<SavingsMode, string> = {
  fixed: 'La misma cantidad todos los meses.',
  percent: 'Un porcentaje de tu ingreso de referencia (o de lo cobrado, si un mes cobras menos).',
  max: 'El porcentaje, pero nunca menos del mínimo. Los meses buenos ahorras más y los malos tienes un suelo.',
};

function BudgetForm({ settings, buckets }: { settings: Settings; buckets: Bucket[] }) {
  const { update, save } = useSaveSettings(settings);
  const recurring = useRecurring();
  const [reference, setReference] = useState(
    settings.referenceIncomeCents !== null ? centsToInput(settings.referenceIncomeCents) : '',
  );
  const [savingsMode, setSavingsMode] = useState<SavingsMode>(settings.savingsMode);
  const [minSavings, setMinSavings] = useState(centsToInput(settings.minSavingsCents));
  const [savingsPct, setSavingsPct] = useState(String(settings.savingsPct));
  const [savingsBucketId, setSavingsBucketId] = useState<number | null>(settings.savingsBucketId);
  const [threshold, setThreshold] = useState(String(settings.healthThresholdPct));
  const [localError, setLocalError] = useState<string | null>(null);

  const usesFixed = savingsMode !== 'percent';
  const usesPct = savingsMode !== 'fixed';

  // Vista previa con lo que hay escrito ahora mismo en el formulario.
  const previewSettings: Settings = {
    ...settings,
    referenceIncomeCents: reference.trim() === '' ? null : parseEuros(reference),
    savingsMode,
    minSavingsCents: parseEuros(minSavings) ?? 0,
    savingsPct: Math.min(100, Math.max(0, Number(savingsPct) || 0)),
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
    await save({ referenceIncomeCents, savingsMode, minSavingsCents, savingsPct: pct, savingsBucketId, healthThresholdPct });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Field
        label="Ingreso de referencia"
        hint={
          <>
            Lo que cobras <strong>seguro</strong> cualquier mes, incluso en verano sin dietas. El mes se presupuesta
            con esta cifra; lo que cobres por encima es <em>extra</em>. Si lo dejas vacío, se usa todo lo cobrado.
          </>
        }
      >
        <MoneyInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="1.000,00" />
      </Field>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Ahorro mensual</legend>
        <Segmented
          options={SAVINGS_MODES.map((m) => ({ value: m, label: SAVINGS_MODE_LABELS[m] }))}
          value={savingsMode}
          onChange={setSavingsMode}
        />
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

        <Field label="Hucha del ahorro mensual" hint="Al cerrar cada mes, el ahorro se mete en esta hucha.">
          <BucketSelect buckets={buckets} value={savingsBucketId} onChange={setSavingsBucketId} />
        </Field>
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
        {update.isPending ? 'Guardando…' : 'Guardar'}
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

// ---- Reparto del extra y de los ingresos puntuales ----

const EXAMPLE_EXTRA = 40000;

type RulesField = 'extraRules' | 'oneOffRules';

function RulesForm({ settings, buckets, field }: { settings: Settings; buckets: Bucket[]; field: RulesField }) {
  const { update, save } = useSaveSettings(settings);
  const isOneOff = field === 'oneOffRules';
  // Los puntuales sin reglas propias usan las del extra.
  const [sameAsExtra, setSameAsExtra] = useState(isOneOff && settings.oneOffRules.length === 0);
  const startRules = isOneOff && settings.oneOffRules.length === 0 ? settings.extraRules : settings[field];

  // Una fila por hucha (aunque esté a 0 %) más la parte libre.
  const initial = (id: number | null) => String(startRules.find((r) => r.bucketId === id)?.pct ?? 0);
  const [pcts, setPcts] = useState<Record<string, string>>(() => {
    const entries: Record<string, string> = { free: initial(null) };
    for (const b of buckets) entries[b.id] = initial(b.id);
    return entries;
  });

  const rows: { key: string; bucketId: number | null; label: string }[] = [
    ...buckets.map((b) => ({ key: String(b.id), bucketId: b.id, label: `${b.icon} ${b.name}` })),
    { key: 'free', bucketId: null, label: '🎈 Libre (para gastar ese mes)' },
  ];
  const value = (key: string) => Math.max(0, Math.min(100, Number(pcts[key]) || 0));
  const total = rows.reduce((s, r) => s + value(r.key), 0);
  const valid = sameAsExtra || total === 100 || total === 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const rules: ExtraRule[] = sameAsExtra
      ? []
      : rows.filter((r) => value(r.key) > 0).map((r) => ({ bucketId: r.bucketId, pct: value(r.key) }));
    await save({ [field]: rules });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {isOneOff && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sameAsExtra}
            onChange={(e) => setSameAsExtra(e.target.checked)}
            className="size-4 accent-emerald-600"
          />
          Usar el mismo reparto que el extra
        </label>
      )}
      {!sameAsExtra && (
        <>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                <span className="w-20 text-right text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {value(r.key) > 0 ? formatEuros(Math.round((EXAMPLE_EXTRA * value(r.key)) / 100)) : ''}
                </span>
                <div className="w-24 shrink-0">
                  <PercentInput
                    value={pcts[r.key] ?? '0'}
                    onChange={(v) => setPcts({ ...pcts, [r.key]: v })}
                    min={0}
                    label={r.label}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between text-sm">
            <span className="text-xs text-slate-500 dark:text-slate-400">Ejemplo con {formatEuros(EXAMPLE_EXTRA)}</span>
            <span
              className={cx('font-semibold tabular-nums', valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600')}
            >
              Suma: {total} %
            </span>
          </div>
          {!valid && <p className="text-sm text-rose-600">El reparto debe sumar 100 %.</p>}
        </>
      )}
      <ErrorText error={update.error} />
      <Button type="submit" disabled={update.isPending || !valid} className="w-full py-2.5">
        {update.isPending ? 'Guardando…' : 'Guardar reparto'}
      </Button>
    </form>
  );
}

// ---- Objetivo de reparto ----

const TARGET_PRESETS: [number, number, number][] = [
  [50, 30, 20],
  [50, 20, 30],
  [60, 10, 30],
  [50, 10, 40],
];

function TargetsForm({ settings }: { settings: Settings }) {
  const { update, save } = useSaveSettings(settings);
  const [needs, setNeeds] = useState(String(settings.targetNeedsPct));
  const [wants, setWants] = useState(String(settings.targetWantsPct));
  const [savings, setSavings] = useState(String(settings.targetSavingsPct));
  const n = Number(needs) || 0;
  const w = Number(wants) || 0;
  const s = Number(savings) || 0;
  const total = n + w + s;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (total !== 100) return;
    await save({ targetNeedsPct: n, targetWantsPct: w, targetSavingsPct: s });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TARGET_PRESETS.map(([pn, pw, ps]) => {
          const active = n === pn && w === pw && s === ps;
          return (
            <button
              key={`${pn}${pw}${ps}`}
              type="button"
              onClick={() => {
                setNeeds(String(pn));
                setWants(String(pw));
                setSavings(String(ps));
              }}
              className={cx(
                'rounded-full px-3 py-1.5 text-sm tabular-nums',
                active ? 'bg-emerald-600 text-white' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700',
              )}
            >
              {pn}/{pw}/{ps}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Necesidades">
          <PercentInput value={needs} onChange={setNeeds} min={0} />
        </Field>
        <Field label="Deseos">
          <PercentInput value={wants} onChange={setWants} min={0} />
        </Field>
        <Field label="Ahorro">
          <PercentInput value={savings} onChange={setSavings} min={0} />
        </Field>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <strong>Necesidades</strong>: fijos, provisiones y presupuestos (casa, cuota, gasolina…).{' '}
        <strong>Deseos</strong>: el gasto libre (ocio, caprichos, impulsivos). <strong>Ahorro</strong>: todo lo que
        acaba en huchas.
      </p>
      {total !== 100 && <p className="text-sm text-rose-600">Suma {total} %: debe sumar 100 %.</p>}
      <ErrorText error={update.error} />
      <Button type="submit" disabled={update.isPending || total !== 100} className="w-full py-2.5">
        {update.isPending ? 'Guardando…' : 'Guardar objetivo'}
      </Button>
    </form>
  );
}

// ---- Controles ----

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            'rounded-md px-2 py-1.5 text-sm font-medium',
            value === o.value ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-500 dark:text-slate-400',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BucketSelect({
  buckets,
  value,
  onChange,
}: {
  buckets: Bucket[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Elige una hucha…</option>
      {buckets.map((b) => (
        <option key={b.id} value={b.id}>
          {b.icon} {b.name}
        </option>
      ))}
    </Select>
  );
}

function PercentInput({
  value,
  onChange,
  min,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  min: number;
  label?: string;
}) {
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
        aria-label={label}
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
        %
      </span>
    </div>
  );
}
