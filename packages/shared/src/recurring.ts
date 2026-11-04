import { addMonths, monthBounds, parseMonth } from './dates.ts';

export const RECURRING_TYPES = ['fixed', 'provision', 'variable'] as const;
export type RecurringType = (typeof RECURRING_TYPES)[number];

export const RECURRING_TYPE_LABELS: Record<RecurringType, string> = {
  fixed: 'Fijo mensual',
  provision: 'Provisión',
  variable: 'Variable estimado',
};

/** Periodos permitidos para provisiones, en meses. */
export const PROVISION_FREQUENCIES = [2, 3, 4, 6, 12] as const;

export const FREQUENCY_LABELS: Record<number, string> = {
  1: 'mensual',
  2: 'bimestral',
  3: 'trimestral',
  4: 'cuatrimestral',
  6: 'semestral',
  12: 'anual',
};

export interface AmountVersion {
  amountCents: number;
  /** Fecha desde la que aplica este importe ('YYYY-MM-DD'). */
  validFrom: string;
}

export interface RecurringForCalc {
  type: RecurringType;
  frequencyMonths: number;
  /** Mes (1-12) en el que se cobra una provisión. Null en fijos/variables. */
  dueMonth: number | null;
  startDate: string;
  endDate: string | null;
  amounts: AmountVersion[];
}

/** Importe vigente en una fecha: el más reciente con validFrom <= fecha. */
export function amountAt(amounts: AmountVersion[], date: string): number | null {
  let best: AmountVersion | null = null;
  for (const a of amounts) {
    if (a.validFrom <= date && (best === null || a.validFrom > best.validFrom)) best = a;
  }
  return best?.amountCents ?? null;
}

export function isActiveInMonth(r: RecurringForCalc, month: string): boolean {
  const { start, end } = monthBounds(month);
  return r.startDate <= end && (r.endDate === null || r.endDate >= start);
}

/** ¿Hay que pagar este recurrente en ese mes? (las provisiones solo en su mes de cargo) */
export function isDueInMonth(r: RecurringForCalc, month: string): boolean {
  if (!isActiveInMonth(r, month)) return false;
  if (r.type !== 'provision') return true;
  if (r.dueMonth === null) return false;
  const { month: m } = parseMonth(month);
  const diff = (((m - r.dueMonth) % r.frequencyMonths) + r.frequencyMonths) % r.frequencyMonths;
  return diff === 0;
}

/**
 * Lo que este recurrente "consume" del presupuesto de un mes:
 * - fijo y variable: su importe
 * - provisión: la parte proporcional que hay que apartar (redondeada hacia arriba)
 * Usa el importe vigente al final del mes.
 */
export function monthlyCommitment(r: RecurringForCalc, month: string): number {
  if (!isActiveInMonth(r, month)) return 0;
  const amount = amountAt(r.amounts, monthBounds(month).end);
  if (amount === null) return 0;
  if (r.type === 'provision') return Math.ceil(amount / r.frequencyMonths);
  return amount;
}

export interface CommitmentSummary {
  fixed: number;
  provision: number;
  variable: number;
  total: number;
}

export function commitmentSummary(list: RecurringForCalc[], month: string): CommitmentSummary {
  const summary: CommitmentSummary = { fixed: 0, provision: 0, variable: 0, total: 0 };
  for (const r of list) {
    const c = monthlyCommitment(r, month);
    summary[r.type] += c;
    summary.total += c;
  }
  return summary;
}

/** Próximo mes (desde `from`, incluido) en el que hay que pagar. Null si no hay ninguno en 2 años. */
export function nextDueMonth(r: RecurringForCalc, from: string): string | null {
  for (let i = 0; i <= 24; i++) {
    const month = addMonths(from, i);
    if (isDueInMonth(r, month)) return month;
  }
  return null;
}
