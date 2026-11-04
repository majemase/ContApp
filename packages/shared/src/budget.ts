import { daysInMonth, monthBounds, toMonth } from './dates.ts';
import {
  type CommitmentSummary,
  type RecurringForCalc,
  type RecurringType,
  amountAt,
  commitmentSummary,
  isDueInMonth,
  monthlyCommitment,
} from './recurring.ts';
import type { Settings } from './schemas.ts';

// Cálculo del presupuesto de un mes. Todo en céntimos.
//
//   base        = ingreso de referencia (o lo cobrado, si es menos)
//   ahorro      = importe fijo, % de la base, o lo mayor de los dos (según ajustes)
//   disponible  = base − fijos − provisiones − variables − ahorro
//   restante    = disponible − gasto libre − excesos de variables − sobrecostes de fijos
//
// Cómo cuenta cada gasto:
// - Vinculado a un fijo: ya está en lo comprometido; solo cuenta lo que supere el importe previsto.
// - Vinculado a una provisión: se paga con lo apartado; no cuenta.
// - De un variable (vinculado o de su categoría): cuenta contra su presupuesto; el exceso, contra el disponible.
// - Resto: gasto libre, contra el disponible.

export interface BudgetRecurring extends RecurringForCalc {
  id: number;
  name: string;
  categoryId: number | null;
  dueDay: number | null;
}

export interface BudgetExpense {
  id: number;
  date: string;
  amountCents: number;
  categoryId: number | null;
  recurringExpenseId: number | null;
}

export interface BudgetInput {
  month: string;
  /** Fecha de hoy ('YYYY-MM-DD'), para los días restantes y el ritmo de gasto. */
  today: string;
  settings: Settings;
  /** Ingresos del mes. */
  incomes: { amountCents: number }[];
  /** Gastos del mes. */
  expenses: BudgetExpense[];
  /** Todos los recurrentes del ámbito (los inactivos ese mes se ignoran). */
  recurring: BudgetRecurring[];
}

export interface VariableStatus {
  id: number;
  name: string;
  categoryId: number | null;
  budget: number;
  spent: number;
}

export interface DueStatus {
  id: number;
  name: string;
  type: Exclude<RecurringType, 'variable'>;
  categoryId: number | null;
  dueDay: number | null;
  /** Importe a pagar este mes (en provisiones, el pago completo). */
  amount: number;
  paid: number;
  isPaid: boolean;
}

export type HealthStatus = 'ok' | 'warning' | 'critical';
export type PaceStatus = 'ok' | 'over' | 'none';

export interface MonthBudget {
  income: {
    /** Lo cobrado de verdad este mes. */
    actual: number;
    /** Referencia configurada (null si no hay). */
    reference: number | null;
    /** Con lo que se presupuesta el mes. */
    base: number;
    /** true si aún no hay ingresos apuntados y se usa la referencia como estimación. */
    estimated: boolean;
    /** Lo cobrado por encima de la referencia (para repartir en huchas). */
    extra: number;
  };
  commitments: CommitmentSummary;
  /** Ahorro que se aparta este mes. */
  savings: number;
  available: number;
  spent: {
    /** Gastos sin vínculo a recurrentes ni presupuestos. */
    free: number;
    variableOverspend: number;
    fixedOverrun: number;
    /** Pagos de provisiones (salen de lo apartado). */
    fromProvisions: number;
    /** Todo lo gastado en el mes, cuente o no contra el disponible. */
    total: number;
  };
  remaining: number;
  /** Días que quedan incluyendo hoy. Null en meses pasados. */
  daysLeft: number | null;
  dailyAllowance: number | null;
  pace: {
    /** Lo que "tocaría" llevar gastado hasta hoy si gastas al ritmo justo. */
    expected: number;
    status: PaceStatus;
  };
  health: {
    /** (comprometido + ahorro) / ingreso de referencia, en %. */
    ratioPct: number | null;
    thresholdPct: number;
    status: HealthStatus;
  };
  variables: VariableStatus[];
  dues: DueStatus[];
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Ahorro del mes según el modo configurado. El % se aplica sobre el ingreso presupuestado (base). */
export function monthlySavings(settings: Settings, base: number): number {
  const fixed = settings.minSavingsCents;
  const percent = Math.round((Math.max(0, base) * settings.savingsPct) / 100);
  if (settings.savingsMode === 'fixed') return fixed;
  if (settings.savingsMode === 'percent') return percent;
  return Math.max(fixed, percent);
}

export function computeMonthBudget(input: BudgetInput): MonthBudget {
  const { month, today, settings, incomes, expenses, recurring } = input;
  const monthEnd = monthBounds(month).end;

  // ---- Ingresos ----
  const actual = sum(incomes.map((i) => i.amountCents));
  const reference = settings.referenceIncomeCents;
  const estimated = incomes.length === 0 && reference !== null;
  let base: number;
  if (reference === null) base = actual;
  else if (estimated) base = reference;
  else base = Math.min(actual, reference);
  const extra = reference !== null ? Math.max(0, actual - reference) : 0;

  // ---- Comprometido ----
  const commitments = commitmentSummary(recurring, month);
  const savings = monthlySavings(settings, base);
  const available = base - commitments.total - savings;

  // ---- Clasificación de gastos ----
  const active = recurring.filter((r) => monthlyCommitment(r, month) > 0);
  const byId = new Map(active.map((r) => [r.id, r]));
  // Si dos variables comparten categoría, la categoría se asigna al primero.
  const variableByCategory = new Map<number, BudgetRecurring>();
  for (const r of active) {
    if (r.type === 'variable' && r.categoryId !== null && !variableByCategory.has(r.categoryId)) {
      variableByCategory.set(r.categoryId, r);
    }
  }

  const linkedSpent = new Map<number, number>();
  let free = 0;
  let fromProvisions = 0;
  for (const e of expenses) {
    const linked = e.recurringExpenseId !== null ? byId.get(e.recurringExpenseId) : undefined;
    const target = linked ?? (e.categoryId !== null ? variableByCategory.get(e.categoryId) : undefined);
    if (!target) {
      free += e.amountCents;
    } else if (target.type === 'provision') {
      fromProvisions += e.amountCents;
      linkedSpent.set(target.id, (linkedSpent.get(target.id) ?? 0) + e.amountCents);
    } else {
      linkedSpent.set(target.id, (linkedSpent.get(target.id) ?? 0) + e.amountCents);
    }
  }

  const variables: VariableStatus[] = active
    .filter((r) => r.type === 'variable')
    .map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      budget: monthlyCommitment(r, month),
      spent: linkedSpent.get(r.id) ?? 0,
    }));
  const variableOverspend = sum(variables.map((v) => Math.max(0, v.spent - v.budget)));

  const dues: DueStatus[] = recurring
    .filter((r): r is BudgetRecurring & { type: 'fixed' | 'provision' } => r.type !== 'variable')
    .filter((r) => isDueInMonth(r, month))
    .map((r) => {
      const amount = amountAt(r.amounts, monthEnd) ?? 0;
      const paid = linkedSpent.get(r.id) ?? 0;
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        categoryId: r.categoryId,
        dueDay: r.dueDay,
        amount,
        paid,
        isPaid: paid > 0,
      };
    })
    .sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99) || a.name.localeCompare(b.name));
  const fixedOverrun = sum(dues.filter((d) => d.type === 'fixed').map((d) => Math.max(0, d.paid - d.amount)));

  const remaining = available - free - variableOverspend - fixedOverrun;

  // ---- Días restantes y ritmo ----
  const days = daysInMonth(month);
  const currentMonth = toMonth(today);
  let daysLeft: number | null = null;
  let elapsedRatio = 0;
  if (month === currentMonth) {
    const day = Number(today.slice(8, 10));
    daysLeft = days - day + 1;
    elapsedRatio = day / days;
  } else if (month > currentMonth) {
    daysLeft = days;
  } else {
    elapsedRatio = 1;
  }
  const dailyAllowance = daysLeft === null ? null : Math.max(0, Math.floor(remaining / daysLeft));

  const counted = free + variableOverspend + fixedOverrun;
  const expected = Math.round(Math.max(0, available) * elapsedRatio);
  let paceStatus: PaceStatus = 'none';
  if (month === currentMonth && available > 0) paceStatus = counted > expected ? 'over' : 'ok';

  // ---- Salud ----
  const healthBase = reference ?? (actual > 0 ? actual : null);
  const ratioPct = healthBase ? Math.round(((commitments.total + savings) / healthBase) * 100) : null;
  let healthStatus: HealthStatus = 'ok';
  if (ratioPct !== null && ratioPct > 100) healthStatus = 'critical';
  else if (ratioPct !== null && ratioPct > settings.healthThresholdPct) healthStatus = 'warning';

  return {
    income: { actual, reference, base, estimated, extra },
    commitments,
    savings,
    available,
    spent: {
      free,
      variableOverspend,
      fixedOverrun,
      fromProvisions,
      total: sum(expenses.map((e) => e.amountCents)),
    },
    remaining,
    daysLeft,
    dailyAllowance,
    pace: { expected, status: paceStatus },
    health: { ratioPct, thresholdPct: settings.healthThresholdPct, status: healthStatus },
    variables,
    dues,
  };
}
