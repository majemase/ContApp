import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  type Bucket,
  type Category,
  type DueStatus,
  type MonthBudget,
  type MonthClose,
  type Settings,
  addMonths,
  currentMonth,
  daysInMonth,
  formatEuros,
  monthLabel,
  monthMeter,
  monthSchema,
  proposeClose,
  todayISO,
} from '@contapp/shared';
import {
  useBuckets,
  useCategories,
  useCreateExpense,
  useCreateMovement,
  useDeleteExpense,
  useExpenses,
  useIncomes,
  useMonthCloses,
  useMonthMovements,
} from '../api';
import { QuickExpenseForm } from '../components/ExpenseForm';
import { Meter } from '../components/Meter';
import { CategoryIcon } from '../components/categories';
import { useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Modal, MonthPicker, cx } from '../components/ui';
import { useMonthBudget } from '../hooks';

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const parsedMonth = monthSchema.safeParse(params.get('mes'));
  const month = parsedMonth.success ? parsedMonth.data : currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { mes: m });
  const [adding, setAdding] = useState(false);

  const state = useMonthBudget(month);
  const categories = useCategories(true);
  const buckets = useBuckets();
  const closes = useMonthCloses();
  const error = state.status === 'error' ? state.error : (categories.error ?? buckets.error ?? closes.error);

  const monthQuery = month === currentMonth() ? '' : `?mes=${month}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Resumen</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {error ? (
        <ErrorText error={error} />
      ) : state.status !== 'ready' || !categories.data || !buckets.data || !closes.data ? (
        <EmptyState>Cargando…</EmptyState>
      ) : (
        <Dashboard
          month={month}
          monthQuery={monthQuery}
          budget={state.budget}
          settings={state.settings}
          buckets={buckets.data}
          close={closes.data.find((c) => c.month === month) ?? null}
          closes={closes.data}
          categoryById={new Map(categories.data.map((c) => [c.id, c]))}
        />
      )}

      {/* Botón flotante para apuntar un gasto sin salir del resumen */}
      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="Apuntar gasto"
        className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-emerald-600 text-3xl text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-700 active:scale-95 md:right-[calc(50%-21rem)]"
      >
        +
      </button>
      <Modal open={adding} onClose={() => setAdding(false)} title="Apuntar gasto">
        <QuickExpenseForm month={month} onAdded={() => setAdding(false)} />
      </Modal>
    </>
  );
}

function Dashboard({
  month,
  monthQuery,
  budget,
  settings,
  buckets,
  close,
  closes,
  categoryById,
}: {
  month: string;
  monthQuery: string;
  budget: MonthBudget;
  settings: Settings;
  buckets: Bucket[];
  close: MonthClose | null;
  closes: MonthClose[];
  categoryById: Map<number, Category>;
}) {
  const nothingYet = settings.referenceIncomeCents === null && budget.income.actual === 0;
  const isCurrent = month === currentMonth();
  const targets = { needs: settings.targetNeedsPct, wants: settings.targetWantsPct, savings: settings.targetSavingsPct };

  return (
    <>
      {isCurrent && <PreviousMonthBanner closes={closes} />}

      {close && (
        <Card className="flex items-center gap-3 bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900">
          <span className="text-xl">✅</span>
          <p className="flex-1 text-sm">
            Mes cerrado. Si cambias algo, reábrelo y vuelve a cerrarlo para que las huchas cuadren.
          </p>
          <Link to={`/cerrar/${month}`} className="text-sm font-medium text-emerald-700 underline dark:text-emerald-400">
            Ver
          </Link>
        </Card>
      )}

      {nothingYet && (
        <Card className="bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900">
          <p className="font-medium">Para empezar</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Configura tu{' '}
            <Link to="/ajustes" className="font-medium text-emerald-700 underline dark:text-emerald-400">
              ingreso de referencia
            </Link>{' '}
            o{' '}
            <Link to={`/ingresos${monthQuery}`} className="font-medium text-emerald-700 underline dark:text-emerald-400">
              apunta lo que has cobrado
            </Link>{' '}
            este mes para ver cuánto puedes gastar.
          </p>
        </Card>
      )}

      <HealthBanner budget={budget} />
      {!nothingYet && !close && <Hero budget={budget} monthQuery={monthQuery} />}
      {!close && <CushionSuggestion budget={budget} buckets={buckets} month={month} />}
      {budget.income.extra > 0 && <ExtraCard budget={budget} settings={settings} buckets={buckets} closed={!!close} />}

      <Dues dues={budget.dues} month={month} categoryById={categoryById} />
      <Budgets budget={budget} categoryById={categoryById} />

      {!nothingYet && (
        <Section title={close ? 'Tu reparto' : 'Tu reparto (si el mes acabara hoy)'}>
          <Card>
            <Meter
              values={
                close
                  ? { income: close.incomeCents, needs: close.needsCents, wants: close.wantsCents, savings: close.savingsCents }
                  : monthMeter(budget)
              }
              targets={targets}
            />
          </Card>
        </Section>
      )}

      {!nothingYet && <Breakdown budget={budget} />}

      {!close && month <= currentMonth() && !nothingYet && (
        <Link to={`/cerrar/${month}`} className="block">
          <Card className="flex items-center gap-3 transition hover:ring-emerald-300 dark:hover:ring-emerald-800">
            <span className="text-2xl">🔒</span>
            <div className="flex-1">
              <p className="font-medium">Cerrar {monthLabel(month)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isCurrent
                  ? 'Al acabar el mes: reparte el ahorro, el extra y lo que sobre en tus huchas.'
                  : 'Reparte el ahorro, el extra y lo que sobró en tus huchas.'}
              </p>
            </div>
            <span className="text-slate-400">›</span>
          </Card>
        </Link>
      )}
    </>
  );
}

// ---- Mes anterior sin cerrar ----

function PreviousMonthBanner({ closes }: { closes: MonthClose[] }) {
  const previous = addMonths(currentMonth(), -1);
  const incomes = useIncomes(previous);
  const expenses = useExpenses(previous);
  const hasData = (incomes.data?.length ?? 0) > 0 || (expenses.data?.length ?? 0) > 0;
  if (!hasData || closes.some((c) => c.month === previous)) return null;

  return (
    <Link to={`/cerrar/${previous}`} className="block">
      <Card className="flex items-center gap-3 bg-sky-50 ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-900">
        <span className="text-xl">🔒</span>
        <p className="flex-1 text-sm">
          <strong className="first-letter:uppercase">{monthLabel(previous)}</strong> está sin cerrar. Ciérralo para
          repartir lo que sobró en tus huchas.
        </p>
        <span className="text-slate-400">›</span>
      </Card>
    </Link>
  );
}

// ---- Usar el colchón en un mes malo ----

function CushionSuggestion({ budget, buckets, month }: { budget: MonthBudget; buckets: Bucket[]; month: string }) {
  const create = useCreateMovement();
  const movements = useMonthMovements(month);
  const toast = useToast();
  const { reference, actual, estimated } = budget.income;
  const cushion = buckets.find((b) => b.type === 'cushion' && b.balanceCents > 0);
  if (reference === null || estimated || actual >= reference || !cushion || !movements.data) return null;

  // Lo que ya se ha sacado de huchas este mes para gastar cuenta como cubierto.
  const alreadyCovered = -movements.data
    .filter((m) => m.affectsBudget && m.amountCents < 0)
    .reduce((s, m) => s + m.amountCents, 0);
  const shortfall = reference - actual - alreadyCovered;
  if (shortfall <= 0) return null;
  const amount = Math.min(shortfall, cushion.balanceCents);
  const date = month === currentMonth() ? todayISO() : `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

  return (
    <Card className="space-y-2 bg-sky-50 ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-900">
      <p className="text-sm">
        Este mes te faltan <strong>{formatEuros(shortfall)}</strong> para llegar a tu referencia. Puedes
        completarlo con tu {cushion.icon} {cushion.name} (tiene {formatEuros(cushion.balanceCents)}).
      </p>
      <Button
        variant="secondary"
        disabled={create.isPending}
        onClick={async () => {
          try {
            await create.mutateAsync({
              bucketId: cushion.id,
              amountCents: -amount,
              date,
              kind: 'manual',
              affectsBudget: true,
              note: 'Completar el mes hasta la referencia',
            });
            toast({ message: `${formatEuros(amount)} del colchón para este mes`, tone: 'success' });
          } catch (err) {
            toast({ message: err instanceof Error ? err.message : 'No se pudo guardar', tone: 'error' });
          }
        }}
      >
        Usar {formatEuros(amount)} del colchón
      </Button>
    </Card>
  );
}

// ---- Extra ----

function ExtraCard({
  budget,
  settings,
  buckets,
  closed,
}: {
  budget: MonthBudget;
  settings: Settings;
  buckets: Bucket[];
  closed: boolean;
}) {
  // Lo que irá a cada hucha al cerrar, según las reglas.
  const toBuckets = proposeClose({ budget, settings, buckets, leftoverBucketId: null, coverBucketId: null }).movements.filter(
    (m) => m.kind === 'extra',
  );
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const hasRules = settings.extraRules.length > 0;

  return (
    <Card className="space-y-2 bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
      <div className="flex items-center gap-3">
        <span className="text-2xl">✨</span>
        <p className="flex-1 font-semibold">
          {formatEuros(budget.income.extra)} extra sobre tu referencia
          {budget.income.extraOneOff > 0 && (
            <span className="block text-xs font-normal text-slate-600 dark:text-slate-300">
              {formatEuros(budget.income.extraOneOff)} son ingresos puntuales (atrasos, devoluciones)
            </span>
          )}
        </p>
      </div>
      {!hasRules ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Decide cómo repartirlo en{' '}
          <Link to="/ajustes" className="font-medium underline">
            Ajustes → Reparto del extra
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
          {budget.income.extraFree > 0 && (
            <li>🎈 {formatEuros(budget.income.extraFree)} libres: ya están sumados a lo que puedes gastar</li>
          )}
          {toBuckets.map((m, i) => (
            <li key={i}>
              {byId.get(m.bucketId)?.icon} {formatEuros(m.amountCents)} → {byId.get(m.bucketId)?.name}
              {m.note?.startsWith('Puntual') && ' (atrasos/devoluciones)'}
              {closed ? '' : ' (al cerrar el mes)'}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- Salud ----

function HealthBanner({ budget }: { budget: MonthBudget }) {
  const { status, ratioPct, thresholdPct } = budget.health;
  if (status === 'ok' || ratioPct === null) return null;
  const critical = status === 'critical';
  return (
    <Card
      className={cx(
        'flex gap-3',
        critical
          ? 'bg-rose-50 ring-rose-200 dark:bg-rose-950/40 dark:ring-rose-900'
          : 'bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900',
      )}
    >
      <span className="text-xl">{critical ? '🚨' : '⚠️'}</span>
      <div className="text-sm">
        <p className="font-semibold">
          {critical ? 'Lo comprometido supera tu ingreso' : `Lo comprometido es el ${ratioPct} % de tu ingreso`}
        </p>
        <p className="text-slate-600 dark:text-slate-300">
          {critical
            ? `Fijos, provisiones, variables y ahorro suman el ${ratioPct} % de tu ingreso de referencia. Revisa tus recurrentes o el ahorro en Ajustes.`
            : `Tu límite está en el ${thresholdPct} %. Queda poco margen para el día a día y los imprevistos.`}
        </p>
      </div>
    </Card>
  );
}

// ---- Lo que queda ----

function Hero({ budget, monthQuery }: { budget: MonthBudget; monthQuery: string }) {
  const { remaining, spendable, daysLeft, dailyAllowance, pace, income } = budget;
  const counted = budget.spent.free + budget.spent.variableOverspend + budget.spent.fixedOverrun;
  const over = remaining < 0;
  const usedPct = spendable > 0 ? Math.min(100, (counted / spendable) * 100) : 100;
  const pacePct = spendable > 0 ? Math.min(100, (pace.expected / spendable) * 100) : 0;

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {over ? 'Te has pasado en' : daysLeft === null ? 'Te sobró' : 'Te quedan para gastar'}
        </p>
        <p
          className={cx(
            'text-4xl font-bold tracking-tight tabular-nums',
            over ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400',
          )}
        >
          {formatEuros(Math.abs(remaining))}
        </p>
        {daysLeft !== null && !over && dailyAllowance !== null && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            ≈ <strong className="tabular-nums">{formatEuros(dailyAllowance)}/día</strong> durante {daysLeft}{' '}
            {daysLeft === 1 ? 'día' : 'días'}
          </p>
        )}
      </div>

      <div>
        <div className="relative h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={cx('h-full rounded-full', over || pace.status === 'over' ? 'bg-rose-500' : 'bg-emerald-500')}
            style={{ width: `${usedPct}%` }}
          />
          {pace.status !== 'none' && (
            <div
              className="absolute inset-y-0 w-0.5 bg-slate-900/60 dark:bg-white/70"
              style={{ left: `${pacePct}%` }}
              title="Lo que tocaría llevar gastado hoy"
            />
          )}
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Gastado {formatEuros(counted)}</span>
          <span>de {formatEuros(Math.max(0, spendable))}</span>
        </div>
      </div>

      {pace.status === 'over' && !over && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          Vas por encima del ritmo: a estas alturas lo justo sería llevar {formatEuros(pace.expected)}.
        </p>
      )}

      {income.estimated && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Calculado con tu ingreso de referencia porque aún no has{' '}
          <Link to={`/ingresos${monthQuery}`} className="font-medium text-emerald-600 underline">
            apuntado la nómina
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

// ---- Pendientes de pago ----

function Dues({ dues, month, categoryById }: { dues: DueStatus[]; month: string; categoryById: Map<number, Category> }) {
  const create = useCreateExpense();
  const remove = useDeleteExpense();
  const toast = useToast();
  if (dues.length === 0) return null;

  const pending = dues.filter((d) => !d.isPaid);
  const isCurrent = month === currentMonth();

  async function pay(d: DueStatus) {
    const day = Math.min(d.dueDay ?? 1, daysInMonth(month));
    const date = isCurrent ? todayISO() : `${month}-${String(day).padStart(2, '0')}`;
    try {
      const created = await create.mutateAsync({
        date,
        amountCents: d.amount,
        categoryId: d.categoryId,
        note: d.name,
        impulsive: false,
        recurringExpenseId: d.id,
      });
      toast({
        message: `${d.name} pagado: ${formatEuros(d.amount)}`,
        tone: 'success',
        action: { label: 'Deshacer', onClick: () => remove.mutate(created.id) },
      });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'No se pudo guardar', tone: 'error' });
    }
  }

  return (
    <Section
      title="Pagos del mes"
      aside={pending.length > 0 ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : 'Todo pagado ✓'}
    >
      <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
        {dues.map((d) => {
          const category = d.categoryId !== null ? categoryById.get(d.categoryId) : undefined;
          return (
            <div key={d.id} className={cx('flex items-center gap-3 px-4 py-3', d.isPaid && 'opacity-60')}>
              <CategoryIcon category={category} />
              <div className="min-w-0 flex-1">
                <p className={cx('truncate font-medium', d.isPaid && 'line-through')}>{d.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {d.type === 'provision' ? 'Sale de lo apartado' : d.dueDay ? `Día ${d.dueDay}` : 'Este mes'}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{formatEuros(d.isPaid ? d.paid : d.amount)}</span>
              {d.isPaid ? (
                <span className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                  ✓
                </span>
              ) : (
                <Button variant="secondary" className="px-2.5 py-1.5" disabled={create.isPending} onClick={() => pay(d)}>
                  Pagar
                </Button>
              )}
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

// ---- Presupuestos (variables) ----

function Budgets({ budget, categoryById }: { budget: MonthBudget; categoryById: Map<number, Category> }) {
  if (budget.variables.length === 0) return null;
  return (
    <Section title="Presupuestos">
      <Card className="space-y-4">
        {budget.variables.map((v) => {
          const pct = v.budget > 0 ? (v.spent / v.budget) * 100 : 0;
          const over = v.spent > v.budget;
          const category = v.categoryId !== null ? categoryById.get(v.categoryId) : undefined;
          return (
            <div key={v.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {category?.icon} {v.name}
                </span>
                <span className={cx('tabular-nums', over && 'font-semibold text-rose-600 dark:text-rose-400')}>
                  {formatEuros(v.spent)} <span className="text-slate-400">/ {formatEuros(v.budget)}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={cx('h-full rounded-full', over ? 'bg-rose-500' : pct > 85 ? 'bg-amber-400' : 'bg-sky-500')}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              {over && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  Te has pasado {formatEuros(v.spent - v.budget)}; sale de tu disponible.
                </p>
              )}
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

// ---- Desglose ----

function Breakdown({ budget }: { budget: MonthBudget }) {
  const { income, commitments, savings, available, spent, remaining, variableSurplus, leftover } = budget;
  return (
    <Section title="Cómo se calcula">
      <Card className="space-y-1.5 text-sm">
        <Line
          label={income.estimated ? 'Ingreso (estimado)' : income.reference !== null ? 'Ingreso presupuestado' : 'Ingresos'}
          value={income.base}
        />
        {income.extraFree > 0 && <Line label="Parte libre del extra" value={income.extraFree} />}
        <Line label="Fijos" value={-commitments.fixed} />
        <Line label="Provisiones (apartar)" value={-commitments.provision} />
        <Line label="Variables (presupuestos)" value={-commitments.variable} />
        {savings > 0 && <Line label="Ahorro" value={-savings} />}
        <Line label="Disponible" value={available} strong />
        <Line label="Gasto libre" value={-spent.free} />
        {spent.variableOverspend > 0 && <Line label="Exceso en presupuestos" value={-spent.variableOverspend} />}
        {spent.fixedOverrun > 0 && <Line label="Fijos más caros de lo previsto" value={-spent.fixedOverrun} />}
        {spent.toBuckets !== 0 && (
          <Line label={spent.toBuckets > 0 ? 'Metido en huchas' : 'Sacado de huchas'} value={-spent.toBuckets} />
        )}
        <Line label="Queda" value={remaining} strong />
        {variableSurplus > 0 && (
          <>
            <Line label="Sin gastar de presupuestos" value={variableSurplus} />
            <Line label="Sobrante al cerrar (si acabara hoy)" value={leftover} strong />
          </>
        )}
        {spent.fromProvisions > 0 && (
          <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
            Además has pagado {formatEuros(spent.fromProvisions)} con lo apartado en provisiones.
          </p>
        )}
      </Card>
    </Section>
  );
}

function Line({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      className={cx(
        'flex justify-between gap-2',
        strong && 'border-t border-slate-200 pt-1.5 font-semibold dark:border-slate-800',
      )}
    >
      <span className={strong ? '' : 'text-slate-600 dark:text-slate-400'}>{label}</span>
      <span className={cx('tabular-nums', value < 0 && !strong && 'text-slate-500 dark:text-slate-400')}>
        {value < 0 ? '−' : ''}
        {formatEuros(Math.abs(value))}
      </span>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</h2>
        {aside && <span className="text-xs text-slate-500 dark:text-slate-400">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
