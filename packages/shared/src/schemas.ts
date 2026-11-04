import { z } from 'zod';
import { PROVISION_FREQUENCIES, RECURRING_TYPES } from './recurring.ts';

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida');
export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Mes no válido');
export const centsSchema = z.int().positive('El importe debe ser mayor que 0');
export const idSchema = z.coerce.number().int().positive();

// ---- Categorías ----

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Pon un nombre').max(40),
  icon: z.string().max(8).default(''),
  color: z.string().max(20).default('slate'),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export interface Category {
  id: number;
  ledgerId: number;
  name: string;
  icon: string;
  color: string;
  archived: boolean;
}

// ---- Gastos recurrentes ----

const recurringBaseSchema = z.object({
  name: z.string().trim().min(1, 'Pon un nombre').max(60),
  type: z.enum(RECURRING_TYPES),
  categoryId: z.int().positive().nullable(),
  frequencyMonths: z.int().min(1).max(12),
  dueMonth: z.int().min(1).max(12).nullable(),
  dueDay: z.int().min(1).max(31).nullable(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  notes: z.string().max(500).default(''),
});

type RecurringBase = z.infer<typeof recurringBaseSchema>;

function checkRecurring(r: RecurringBase, ctx: z.RefinementCtx) {
  if (r.type === 'provision') {
    if (!(PROVISION_FREQUENCIES as readonly number[]).includes(r.frequencyMonths)) {
      ctx.addIssue({ code: 'custom', path: ['frequencyMonths'], message: 'Periodo no válido' });
    }
    if (r.dueMonth === null) {
      ctx.addIssue({ code: 'custom', path: ['dueMonth'], message: 'Indica en qué mes se cobra' });
    }
  } else if (r.frequencyMonths !== 1) {
    ctx.addIssue({ code: 'custom', path: ['frequencyMonths'], message: 'Debe ser mensual' });
  }
  if (r.endDate !== null && r.endDate < r.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La fecha de fin es anterior al inicio' });
  }
}

export const recurringCreateSchema = recurringBaseSchema
  .extend({ amountCents: centsSchema })
  .superRefine(checkRecurring);
export type RecurringCreateInput = z.input<typeof recurringCreateSchema>;

export const recurringUpdateSchema = recurringBaseSchema.superRefine(checkRecurring);
export type RecurringUpdateInput = z.input<typeof recurringUpdateSchema>;

export const amountChangeSchema = z.object({
  amountCents: centsSchema,
  validFrom: isoDateSchema,
});
export type AmountChangeInput = z.input<typeof amountChangeSchema>;

export interface RecurringAmount {
  id: number;
  amountCents: number;
  validFrom: string;
}

export interface RecurringExpense extends RecurringBase {
  id: number;
  ledgerId: number;
  /** Ordenados por validFrom ascendente. */
  amounts: RecurringAmount[];
}

// ---- Gastos ----

export const expenseInputSchema = z.object({
  date: isoDateSchema,
  amountCents: centsSchema,
  categoryId: z.int().positive().nullable(),
  note: z.string().trim().max(200).default(''),
  impulsive: z.boolean().default(false),
  recurringExpenseId: z.int().positive().nullable().default(null),
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;

export interface Expense {
  id: number;
  ledgerId: number;
  categoryId: number | null;
  date: string;
  amountCents: number;
  note: string;
  impulsive: boolean;
  recurringExpenseId: number | null;
  createdAt: string;
}

export interface Ledger {
  id: number;
  name: string;
  kind: 'personal' | 'business';
}

// ---- Ingresos ----

export const INCOME_TYPES = ['salary', 'allowance', 'bonus', 'arrears', 'other'] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: 'Nómina',
  allowance: 'Dietas',
  bonus: 'Paga extra',
  arrears: 'Atrasos',
  other: 'Otro',
};

export const incomeInputSchema = z.object({
  date: isoDateSchema,
  amountCents: centsSchema,
  type: z.enum(INCOME_TYPES),
  note: z.string().trim().max(200).default(''),
});
export type IncomeInput = z.input<typeof incomeInputSchema>;

export interface Income {
  id: number;
  ledgerId: number;
  date: string;
  amountCents: number;
  type: IncomeType;
  note: string;
  createdAt: string;
}

// ---- Ajustes del ámbito ----

/**
 * Cómo se calcula el ahorro que se aparta cada mes:
 * - fixed: un importe fijo
 * - percent: un % del ingreso presupuestado del mes
 * - max: lo mayor de los dos (el importe fijo hace de suelo en los meses malos)
 */
export const SAVINGS_MODES = ['fixed', 'percent', 'max'] as const;
export type SavingsMode = (typeof SAVINGS_MODES)[number];

export const SAVINGS_MODE_LABELS: Record<SavingsMode, string> = {
  fixed: 'Importe fijo',
  percent: 'Porcentaje',
  max: 'Lo mayor',
};

export const settingsSchema = z.object({
  /** Ingreso conservador con el que se presupuesta cada mes. Null = usar lo cobrado. */
  referenceIncomeCents: z.int().positive().nullable(),
  savingsMode: z.enum(SAVINGS_MODES),
  /** Importe fijo de ahorro mensual (modos fixed y max). */
  minSavingsCents: z.int().min(0),
  /** % del ingreso presupuestado que se ahorra (modos percent y max). */
  savingsPct: z.int().min(0).max(100),
  /** % del ingreso de referencia a partir del cual lo comprometido se considera demasiado. */
  healthThresholdPct: z.int().min(1).max(100),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  referenceIncomeCents: null,
  savingsMode: 'fixed',
  minSavingsCents: 0,
  savingsPct: 0,
  healthThresholdPct: 70,
};
