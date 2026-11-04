import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type Bucket,
  type CloseMovement,
  MOVEMENT_KIND_LABELS,
  type MonthBudget,
  type MonthClose,
  type Settings,
  currentMonth,
  dateLabel,
  formatEuros,
  monthLabel,
  monthMeter,
  monthSchema,
  proposeClose,
} from '@contapp/shared';
import { useBuckets, useCloseMonth, useMonthCloses, useReopenMonth } from '../api';
import { useConfirm, useToast } from '../components/feedback';
import { Meter } from '../components/Meter';
import { Button, Card, EmptyState, ErrorText, Field, Select, cx } from '../components/ui';
import { useMonthBudget } from '../hooks';

export function ClosePage() {
  const params = useParams();
  const parsed = monthSchema.safeParse(params.mes);
  if (!parsed.success) return <EmptyState>Mes no válido.</EmptyState>;
  return <CloseMonth month={parsed.data} />;
}

function CloseMonth({ month }: { month: string }) {
  const state = useMonthBudget(month);
  const buckets = useBuckets();
  const closes = useMonthCloses();
  const closed = closes.data?.find((c) => c.month === month);

  return (
    <>
      <Link
        to={month === currentMonth() ? '/' : `/?mes=${month}`}
        className="-mb-2 inline-block text-sm text-emerald-600 dark:text-emerald-400"
      >
        ‹ Resumen
      </Link>
      <h1 className="text-xl font-semibold first-letter:uppercase">Cerrar {monthLabel(month)}</h1>

      {state.status === 'error' ? (
        <ErrorText error={state.error} />
      ) : buckets.error || closes.error ? (
        <ErrorText error={buckets.error ?? closes.error} />
      ) : state.status === 'loading' || !buckets.data || !closes.data ? (
        <EmptyState>Cargando…</EmptyState>
      ) : month > currentMonth() ? (
        <EmptyState>Este mes aún no ha empezado.</EmptyState>
      ) : closed ? (
        <ClosedMonth close={closed} settings={state.settings} />
      ) : (
        <CloseWizard month={month} budget={state.budget} settings={state.settings} buckets={buckets.data} />
      )}
    </>
  );
}

function CloseWizard({
  month,
  budget,
  settings,
  buckets,
}: {
  month: string;
  budget: MonthBudget;
  settings: Settings;
  buckets: Bucket[];
}) {
  const closeMonth = useCloseMonth();
  const toast = useToast();
  const navigate = useNavigate();
  const savingBuckets = buckets.filter((b) => b.type !== 'provision');
  const [leftoverBucketId, setLeftoverBucketId] = useState<number | null>(
    settings.savingsBucketId ?? savingBuckets[0]?.id ?? null,
  );
  const [coverBucketId, setCoverBucketId] = useState<number | null>(
    savingBuckets.find((b) => b.type === 'cushion')?.id ?? savingBuckets[0]?.id ?? null,
  );

  const proposal = proposeClose({ budget, settings, buckets, leftoverBucketId, coverBucketId });
  const meter = monthMeter(budget);
  const isCurrent = month === currentMonth();

  async function handleClose() {
    try {
      await closeMonth.mutateAsync({
        month,
        movements: proposal.movements,
        incomeCents: meter.income,
        needsCents: Math.max(0, meter.needs),
        wantsCents: Math.max(0, meter.wants),
        savingsCents: meter.savings,
      });
      toast({ message: `${monthLabel(month)} cerrado`, tone: 'success' });
      navigate(isCurrent ? '/' : `/?mes=${month}`);
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <>
      {isCurrent && (
        <Card className="bg-amber-50 text-sm ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
          El mes aún no ha terminado. Si lo cierras ahora, lo que gastes después no se tendrá en cuenta (tendrías que
          reabrirlo y volver a cerrarlo).
        </Card>
      )}

      <Card className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Cobrado" value={budget.income.actual} />
        <Stat label="Gastado" value={budget.spent.total} />
        <Stat
          label={budget.leftover >= 0 ? 'Ha sobrado' : 'Te has pasado'}
          value={Math.abs(budget.leftover)}
          tone={budget.leftover >= 0 ? 'good' : 'bad'}
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">¿Adónde va el dinero?</h2>
        {budget.leftover > 0 && (
          <Field label={`Lo que ha sobrado (${formatEuros(budget.leftover)}) va a…`}>
            <BucketSelect buckets={savingBuckets} value={leftoverBucketId} onChange={setLeftoverBucketId} />
          </Field>
        )}
        {budget.leftover < 0 && (
          <Field label={`Cubrir lo que te has pasado (${formatEuros(-budget.leftover)}) desde…`}>
            <BucketSelect buckets={savingBuckets} value={coverBucketId} onChange={setCoverBucketId} />
          </Field>
        )}
        <MovementList movements={proposal.movements} buckets={buckets} />
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Tu reparto este mes</h2>
        <Meter
          values={meter}
          targets={{ needs: settings.targetNeedsPct, wants: settings.targetWantsPct, savings: settings.targetSavingsPct }}
        />
      </Card>

      {proposal.problems.length > 0 && (
        <Card className="space-y-1 bg-rose-50 text-sm ring-rose-200 dark:bg-rose-950/40 dark:ring-rose-900">
          <p className="font-semibold">Antes de cerrar:</p>
          <ul className="list-disc pl-5">
            {proposal.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {proposal.problems.some((p) => p.includes('Ajustes')) && (
            <Link to="/ajustes" className="inline-block font-medium text-rose-700 underline dark:text-rose-300">
              Ir a Ajustes
            </Link>
          )}
        </Card>
      )}
      {proposal.warnings.length > 0 && (
        <Card className="space-y-1 bg-amber-50 text-sm ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
          {proposal.warnings.map((w) => (
            <p key={w}>⚠️ {w}</p>
          ))}
        </Card>
      )}

      <ErrorText error={closeMonth.error} />
      <Button
        onClick={handleClose}
        disabled={proposal.problems.length > 0 || closeMonth.isPending}
        className="w-full py-3 text-base"
      >
        {closeMonth.isPending ? 'Cerrando…' : `Cerrar ${monthLabel(month)}`}
      </Button>
    </>
  );
}

function ClosedMonth({ close, settings }: { close: MonthClose; settings: Settings }) {
  const reopen = useReopenMonth();
  const confirm = useConfirm();
  const toast = useToast();

  return (
    <>
      <Card className="flex items-center gap-3 bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900">
        <span className="text-2xl">✅</span>
        <p className="text-sm">
          Cerrado el {dateLabel(close.closedAt.slice(0, 10))}. Los movimientos ya están en tus huchas.
        </p>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Tu reparto</h2>
        <Meter
          values={{ income: close.incomeCents, needs: close.needsCents, wants: close.wantsCents, savings: close.savingsCents }}
          targets={{ needs: settings.targetNeedsPct, wants: settings.targetWantsPct, savings: settings.targetSavingsPct }}
        />
      </Card>
      <Button
        variant="secondary"
        disabled={reopen.isPending}
        onClick={async () => {
          const ok = await confirm({
            title: '¿Reabrir el mes?',
            message: 'Se desharán los movimientos que generó el cierre. Después podrás volver a cerrarlo.',
            confirmLabel: 'Reabrir',
          });
          if (!ok) return;
          await reopen.mutateAsync(close.month);
          toast({ message: 'Mes reabierto', tone: 'info' });
        }}
      >
        Reabrir mes
      </Button>
      <ErrorText error={reopen.error} />
    </>
  );
}

function MovementList({ movements, buckets }: { movements: CloseMovement[]; buckets: Bucket[] }) {
  if (movements.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Este mes no hay movimientos que hacer.</p>;
  }
  const byId = new Map(buckets.map((b) => [b.id, b]));
  // Saldo de cada hucha tras el cierre.
  const after = new Map<number, number>();
  for (const m of movements) {
    after.set(m.bucketId, (after.get(m.bucketId) ?? byId.get(m.bucketId)?.balanceCents ?? 0) + m.amountCents);
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
      {movements.map((m, i) => {
        const bucket = byId.get(m.bucketId);
        return (
          <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-lg">{bucket?.icon || '🫙'}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{bucket?.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{m.note || MOVEMENT_KIND_LABELS[m.kind]}</p>
            </div>
            <span
              className={cx(
                'font-semibold tabular-nums',
                m.amountCents > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}
            >
              {m.amountCents > 0 ? '+' : '−'}
              {formatEuros(Math.abs(m.amountCents))}
            </span>
          </li>
        );
      })}
      <li className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        Después del cierre:{' '}
        {[...after].map(([id, balance], i) => (
          <span key={id}>
            {i > 0 && ' · '}
            {byId.get(id)?.name} {formatEuros(balance)}
          </span>
        ))}
      </li>
    </ul>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={cx(
          'font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'bad' && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {formatEuros(value)}
      </p>
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
          {b.icon} {b.name} ({formatEuros(b.balanceCents)})
        </option>
      ))}
    </Select>
  );
}
