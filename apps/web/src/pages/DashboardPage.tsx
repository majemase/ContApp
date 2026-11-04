import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  type Category,
  type DueStatus,
  type MonthBudget,
  computeMonthBudget,
  currentMonth,
  daysInMonth,
  formatEuros,
  monthSchema,
  todayISO,
} from '@contapp/shared';
import {
  useCategories,
  useCreateExpense,
  useDeleteExpense,
  useExpenses,
  useIncomes,
  useRecurring,
  useSettings,
} from '../api';
import { QuickExpenseForm } from '../components/ExpenseForm';
import { CategoryIcon } from '../components/categories';
import { useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Modal, MonthPicker, cx } from '../components/ui';

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const parsedMonth = monthSchema.safeParse(params.get('mes'));
  const month = parsedMonth.success ? parsedMonth.data : currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { mes: m });
  const [adding, setAdding] = useState(false);

  const settings = useSettings();
  const incomes = useIncomes(month);
  const expenses = useExpenses(month);
  const recurring = useRecurring();
  const categories = useCategories(true);
  const queries = [settings, incomes, expenses, recurring, categories];
  const error = queries.find((q) => q.error)?.error;

  const monthQuery = month === currentMonth() ? '' : `?mes=${month}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Resumen</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {error ? (
        <ErrorText error={error} />
      ) : !settings.data || !incomes.data || !expenses.data || !recurring.data || !categories.data ? (
        <EmptyState>Cargando…</EmptyState>
      ) : (
        <Dashboard
          month={month}
          monthQuery={monthQuery}
          budget={computeMonthBudget({
            month,
            today: todayISO(),
            settings: settings.data,
            incomes: incomes.data,
            expenses: expenses.data,
            recurring: recurring.data,
          })}
          hasReference={settings.data.referenceIncomeCents !== null}
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
  hasReference,
  categoryById,
}: {
  month: string;
  monthQuery: string;
  budget: MonthBudget;
  hasReference: boolean;
  categoryById: Map<number, Category>;
}) {
  const nothingYet = !hasReference && budget.income.actual === 0;

  return (
    <>
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
      {!nothingYet && <Hero budget={budget} monthQuery={monthQuery} />}

      {budget.income.extra > 0 && (
        <Card className="flex items-center gap-3 bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
          <span className="text-2xl">✨</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold">
              {formatEuros(budget.income.extra)} extra sobre tu referencia
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              No cuenta como dinero para gastar. Pronto podrás repartirlo en tus huchas (colchón, ahorro…).
            </p>
          </div>
        </Card>
      )}

      <Dues dues={budget.dues} month={month} categoryById={categoryById} />
      <Budgets budget={budget} categoryById={categoryById} />
      {!nothingYet && <Breakdown budget={budget} />}
    </>
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
          {critical ? 'Tus gastos fijos superan tu ingreso' : `Lo comprometido es el ${ratioPct} % de tu ingreso`}
        </p>
        <p className="text-slate-600 dark:text-slate-300">
          {critical
            ? `Fijos, provisiones, variables y ahorro mínimo suman el ${ratioPct} % de tu ingreso de referencia. Revisa tus recurrentes.`
            : `Tu límite está en el ${thresholdPct} %. Queda poco margen para el día a día y los imprevistos.`}
        </p>
      </div>
    </Card>
  );
}

// ---- Lo que queda ----

function Hero({ budget, monthQuery }: { budget: MonthBudget; monthQuery: string }) {
  const { remaining, available, daysLeft, dailyAllowance, pace, income } = budget;
  const counted = budget.spent.free + budget.spent.variableOverspend + budget.spent.fixedOverrun;
  const over = remaining < 0;
  const usedPct = available > 0 ? Math.min(100, (counted / available) * 100) : 100;
  const pacePct = available > 0 ? Math.min(100, (pace.expected / available) * 100) : 0;

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
          <span>de {formatEuros(Math.max(0, available))}</span>
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
  const { income, commitments, minSavings, available, spent, remaining } = budget;
  return (
    <Section title="Cómo se calcula">
      <Card className="space-y-1.5 text-sm">
        <Line
          label={income.estimated ? 'Ingreso (estimado)' : income.reference !== null ? 'Ingreso presupuestado' : 'Ingresos'}
          value={income.base}
        />
        <Line label="Fijos" value={-commitments.fixed} />
        <Line label="Provisiones (apartar)" value={-commitments.provision} />
        <Line label="Variables (presupuestos)" value={-commitments.variable} />
        {minSavings > 0 && <Line label="Ahorro mínimo" value={-minSavings} />}
        <Line label="Disponible" value={available} strong />
        <Line label="Gasto libre" value={-spent.free} />
        {spent.variableOverspend > 0 && <Line label="Exceso en presupuestos" value={-spent.variableOverspend} />}
        {spent.fixedOverrun > 0 && <Line label="Fijos más caros de lo previsto" value={-spent.fixedOverrun} />}
        <Line label="Queda" value={remaining} strong />
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
