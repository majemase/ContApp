import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { type Settings, centsToInput, parseEuros } from '@contapp/shared';
import { useSettings, useUpdateSettings } from '../api';
import { useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Field, Input, MoneyInput, PageHeader } from '../components/ui';

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

function SettingsForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [reference, setReference] = useState(
    settings.referenceIncomeCents !== null ? centsToInput(settings.referenceIncomeCents) : '',
  );
  const [minSavings, setMinSavings] = useState(centsToInput(settings.minSavingsCents));
  const [threshold, setThreshold] = useState(String(settings.healthThresholdPct));
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const referenceIncomeCents = reference.trim() === '' ? null : parseEuros(reference);
    const minSavingsCents = minSavings.trim() === '' ? 0 : parseEuros(minSavings);
    const healthThresholdPct = Number(threshold);

    if (reference.trim() !== '' && (referenceIncomeCents === null || referenceIncomeCents <= 0)) {
      return setLocalError('El ingreso de referencia no es válido');
    }
    if (minSavingsCents === null || minSavingsCents < 0) return setLocalError('El ahorro mínimo no es válido');
    if (!Number.isInteger(healthThresholdPct) || healthThresholdPct < 1 || healthThresholdPct > 100) {
      return setLocalError('El umbral debe estar entre 1 y 100');
    }
    setLocalError(null);
    try {
      await update.mutateAsync({ referenceIncomeCents, minSavingsCents, healthThresholdPct });
      toast({ message: 'Ajustes guardados', tone: 'success' });
    } catch {
      // El error se muestra desde la mutación.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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

      <Field
        label="Ahorro mínimo mensual"
        hint="Se aparta todos los meses antes de calcular lo que puedes gastar, aunque sea un mes malo."
      >
        <MoneyInput value={minSavings} onChange={(e) => setMinSavings(e.target.value)} />
      </Field>

      <Field
        label="Aviso de salud del presupuesto (%)"
        hint="Te avisa si tus gastos comprometidos más el ahorro mínimo superan este porcentaje del ingreso de referencia. Un 70 % deja margen para el día a día."
      >
        <div className="relative w-32">
          <Input
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="pr-8"
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">%</span>
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
