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
import { type IncomeType, ONE_OFF_INCOME_TYPES, type Settings, freePct, oneOffRulesOf } from './schemas.ts';

// Cálculo del presupuesto de un mes. Todo en céntimos.
//
//   base        = ingreso de referencia (o lo cobrado, si es menos)
//   ahorro      = importe fijo, % de la base, o lo mayor de los dos (según ajustes)
//   disponible  = base + parte libre del extra − fijos − provisiones − variables − ahorro
//   restante    = disponible − gasto libre − excesos de variables − sobrecostes de fijos
//                 − dinero movido a huchas e inversiones durante el mes (+ lo sacado de ellas)
//   sobrante    = restante + lo no gastado de los presupuestos variables (va a huchas al cerrar)
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
  incomes: { amountCents: number; type?: IncomeType }[];
  /** Gastos del mes. */
  expenses: BudgetExpense[];
  /** Todos los recurrentes del ámbito (los inactivos ese mes se ignoran). */
  recurring: BudgetRecurring[];
  /** Movimientos de huchas de este mes que afectan al disponible (+ entra en la hucha, − sale). */
  budgetMovements?: { amountCents: number }[];
  /** Dinero del mes llevado a inversiones (+) o traído de ellas (−). Ver investmentMonthFlows. */
  investmentFlows?: { amountCents: number }[];
}

export interface ProvisionStatus {
  id: number;
  name: string;
  /** Lo que se aparta este mes. */
  setAside: number;
  /** Lo pagado este mes (sale de su hucha). */
  paid: number;
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
    /** Parte del extra que es libre y se suma a lo disponible del mes. */
    /** Parte del extra que viene de ingresos puntuales (atrasos, devoluciones). */
    extraOneOff: number;
    /** Parte libre del extra (regular y puntual), que se suma a lo disponible del mes. */
    extraFree: number;
  };
  commitments: CommitmentSummary;
  /** Ahorro que se aparta este mes. */
  savings: number;
  available: number;
  /** Lo que hay para gastar este mes: disponible − lo metido en huchas e inversiones + lo sacado de ellas. */
  spendable: number;
  spent: {
    /** Gastos sin vínculo a recurrentes ni presupuestos. */
    free: number;
    variableOverspend: number;
    fixedOverrun: number;
    /** Pagos de provisiones (salen de lo apartado). */
    fromProvisions: number;
    /** Todo lo gastado en el mes, cuente o no contra el disponible. */
    total: number;
    /** Neto movido a huchas durante el mes desde lo disponible (negativo si se ha sacado). */
    toBuckets: number;
    /** Neto llevado a inversiones desde lo disponible (negativo si ha vuelto dinero de ellas). */
    toInvestments: number;
  };
  remaining: number;
  /** Lo no gastado de los presupuestos variables (no está en el restante, pero sobra). */
  variableSurplus: number;
  /** Lo que sobra (o falta, si es negativo) al acabar el mes: restante + variableSurplus. */
  leftover: number;
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
  provisions: ProvisionStatus[];
  dues: DueStatus[];
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Parte libre del extra: la regular con las reglas del extra y la puntual con las suyas. */
export function extraFreeParts(
  settings: Pick<Settings, 'extraRules' | 'oneOffRules'>,
  extra: number,
  extraOneOff: number,
): { regular: number; oneOff: number; total: number } {
  const regular = Math.round(((extra - extraOneOff) * freePct(settings.extraRules)) / 100);
  const oneOff = Math.round((extraOneOff * freePct(oneOffRulesOf(settings))) / 100);
  return { regular, oneOff, total: regular + oneOff };
}

/** Ahorro del mes según el modo configurado. El % se aplica sobre el ingreso presupuestado (base). */
export function monthlySavings(settings: Settings, base: number): number {
  const fixed = settings.minSavingsCents;
  const percent = Math.round((Math.max(0, base) * settings.savingsPct) / 100);
  if (settings.savingsMode === 'fixed') return fixed;
  if (settings.savingsMode === 'percent') return percent;
  return Math.max(fixed, percent);
}

export function computeMonthBudget(input: BudgetInput): MonthBudget {
  const { month, today, settings, incomes, expenses, recurring, budgetMovements = [], investmentFlows = [] } = input;
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
  // El extra se cuenta primero como puntual (atrasos…): cada parte se reparte con sus reglas.
  const oneOffIncome = sum(incomes.filter((i) => i.type && ONE_OFF_INCOME_TYPES.includes(i.type)).map((i) => i.amountCents));
  const extraOneOff = Math.min(extra, oneOffIncome);
  const extraFree = extraFreeParts(settings, extra, extraOneOff).total;

  // ---- Comprometido ----
  const commitments = commitmentSummary(recurring, month);
  const savings = monthlySavings(settings, base);
  const available = base + extraFree - commitments.total - savings;

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

  const toBuckets = sum(budgetMovements.map((m) => m.amountCents));
  const toInvestments = sum(investmentFlows.map((m) => m.amountCents));
  const remaining = available - free - variableOverspend - fixedOverrun - toBuckets - toInvestments;
  const variableSurplus = sum(variables.map((v) => Math.max(0, v.budget - v.spent)));

  const provisions: ProvisionStatus[] = active
    .filter((r) => r.type === 'provision')
    .map((r) => ({ id: r.id, name: r.name, setAside: monthlyCommitment(r, month), paid: linkedSpent.get(r.id) ?? 0 }));

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
  // Lo que hay para gastar este mes: lo disponible menos lo metido en huchas e inversiones (más lo sacado).
  const spendable = available - toBuckets - toInvestments;
  const expected = Math.round(Math.max(0, spendable) * elapsedRatio);
  let paceStatus: PaceStatus = 'none';
  if (month === currentMonth && spendable > 0) paceStatus = counted > expected ? 'over' : 'ok';

  // ---- Salud ----
  const healthBase = reference ?? (actual > 0 ? actual : null);
  const ratioPct = healthBase ? Math.round(((commitments.total + savings) / healthBase) * 100) : null;
  let healthStatus: HealthStatus = 'ok';
  if (ratioPct !== null && ratioPct > 100) healthStatus = 'critical';
  else if (ratioPct !== null && ratioPct > settings.healthThresholdPct) healthStatus = 'warning';

  return {
    income: { actual, reference, base, estimated, extra, extraOneOff, extraFree },
    commitments,
    savings,
    available,
    spendable,
    spent: {
      free,
      variableOverspend,
      fixedOverrun,
      fromProvisions,
      total: sum(expenses.map((e) => e.amountCents)),
      toBuckets,
      toInvestments,
    },
    remaining,
    variableSurplus,
    leftover: remaining + variableSurplus,
    daysLeft,
    dailyAllowance,
    pace: { expected, status: paceStatus },
    health: { ratioPct, thresholdPct: settings.healthThresholdPct, status: healthStatus },
    variables,
    provisions,
    dues,
  };
}
