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

/** owner: todo (incluido invitar) · editor: apuntar y editar · viewer: solo ver. */
export const LEDGER_ROLES = ['owner', 'editor', 'viewer'] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

export interface Ledger {
  id: number;
  name: string;
  kind: 'personal' | 'business';
  /** Tu rol en este ámbito. */
  role: LedgerRole;
}

// ---- Ingresos ----

export const INCOME_TYPES = ['salary', 'allowance', 'bonus', 'arrears', 'refund', 'other'] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: 'Nómina',
  allowance: 'Dietas',
  bonus: 'Paga extra',
  arrears: 'Atrasos',
  refund: 'Devolución',
  other: 'Otro',
};

/** Ingresos puntuales: no se repiten, así que pueden tener su propio reparto. */
export const ONE_OFF_INCOME_TYPES: readonly IncomeType[] = ['arrears', 'refund'];

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

/** Regla de reparto del extra: un % a una hucha, o a "libre" (bucketId null) para gastar ese mes. */
export const extraRuleSchema = z.object({
  bucketId: z.int().positive().nullable(),
  pct: z.int().min(1).max(100),
});
export type ExtraRule = z.infer<typeof extraRuleSchema>;

function checkRules(rules: ExtraRule[], path: string, what: string, ctx: z.RefinementCtx) {
  const total = rules.reduce((a, r) => a + r.pct, 0);
  if (rules.length > 0 && total !== 100) {
    ctx.addIssue({ code: 'custom', path: [path], message: `El reparto ${what} suma ${total} %, debe sumar 100 %` });
  }
  const ids = rules.map((r) => r.bucketId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: [path], message: `Hay un destino repetido en el reparto ${what}` });
  }
}

export const settingsSchema = z
  .object({
    /** Ingreso conservador con el que se presupuesta cada mes. Null = usar lo cobrado. */
    referenceIncomeCents: z.int().positive().nullable(),
    savingsMode: z.enum(SAVINGS_MODES),
    /** Importe fijo de ahorro mensual (modos fixed y max). */
    minSavingsCents: z.int().min(0),
    /** % del ingreso presupuestado que se ahorra (modos percent y max). */
    savingsPct: z.int().min(0).max(100),
    /** Hucha a la que va el ahorro mensual al cerrar el mes. */
    savingsBucketId: z.int().positive().nullable(),
    /** Reparto de lo cobrado por encima de la referencia. Si hay reglas, deben sumar 100 %. */
    extraRules: z.array(extraRuleSchema).max(10),
    /** Reparto de los ingresos puntuales (atrasos, devoluciones). Vacío = el mismo que el extra. */
    oneOffRules: z.array(extraRuleSchema).max(10),
    /** % del ingreso de referencia a partir del cual lo comprometido se considera demasiado. */
    healthThresholdPct: z.int().min(1).max(100),
    /** Objetivo del medidor de reparto (necesidades / deseos / ahorro). Suman 100. */
    targetNeedsPct: z.int().min(0).max(100),
    targetWantsPct: z.int().min(0).max(100),
    targetSavingsPct: z.int().min(0).max(100),
  })
  .superRefine((s, ctx) => {
    checkRules(s.extraRules, 'extraRules', 'del extra', ctx);
    checkRules(s.oneOffRules, 'oneOffRules', 'de los ingresos puntuales', ctx);
    const targetTotal = s.targetNeedsPct + s.targetWantsPct + s.targetSavingsPct;
    if (targetTotal !== 100) {
      ctx.addIssue({ code: 'custom', path: ['targetNeedsPct'], message: `El objetivo de reparto suma ${targetTotal} %, debe sumar 100 %` });
    }
  });
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  referenceIncomeCents: null,
  savingsMode: 'fixed',
  minSavingsCents: 0,
  savingsPct: 0,
  savingsBucketId: null,
  extraRules: [],
  oneOffRules: [],
  healthThresholdPct: 70,
  targetNeedsPct: 50,
  targetWantsPct: 30,
  targetSavingsPct: 20,
};

/** Reglas que se aplican a los ingresos puntuales (las suyas o, si no hay, las del extra). */
export function oneOffRulesOf(settings: Pick<Settings, 'extraRules' | 'oneOffRules'>): ExtraRule[] {
  return settings.oneOffRules.length > 0 ? settings.oneOffRules : settings.extraRules;
}

/** % libre (se puede gastar el mismo mes) de un conjunto de reglas. */
export function freePct(rules: ExtraRule[]): number {
  return rules.find((r) => r.bucketId === null)?.pct ?? 0;
}

// ---- Huchas ----

export const BUCKET_TYPES = ['savings', 'emergency', 'cushion', 'goal', 'provision'] as const;
export type BucketType = (typeof BUCKET_TYPES)[number];

export const BUCKET_TYPE_LABELS: Record<BucketType, string> = {
  savings: 'Ahorro',
  emergency: 'Fondo de emergencia',
  cushion: 'Colchón',
  goal: 'Objetivo',
  provision: 'Provisión',
};

export const bucketInputSchema = z.object({
  name: z.string().trim().min(1, 'Pon un nombre').max(40),
  icon: z.string().max(8).default(''),
  type: z.enum(BUCKET_TYPES).exclude(['provision']),
  targetCents: z.int().positive().nullable().default(null),
});
export type BucketInput = z.input<typeof bucketInputSchema>;

export interface Bucket {
  id: number;
  ledgerId: number;
  name: string;
  icon: string;
  type: BucketType;
  targetCents: number | null;
  /** Gasto recurrente asociado (solo en huchas de provisión). */
  recurringExpenseId: number | null;
  archived: boolean;
  /** Saldo: suma de todos sus movimientos. */
  balanceCents: number;
}

/**
 * Tipos de movimiento:
 * - initial: saldo inicial (dinero que ya tenías ahorrado). No afecta al mes.
 * - manual: meter/sacar dinero. Si `affectsBudget`, sale de / vuelve a lo disponible del mes.
 * - transfer: de una hucha a otra (dos movimientos). No afecta al mes.
 * - Generados al cerrar un mes: savings, provision, provision_payment, extra, leftover, cover.
 */
export const MOVEMENT_KINDS = [
  'initial',
  'manual',
  'transfer',
  'savings',
  'provision',
  'provision_payment',
  'extra',
  'leftover',
  'cover',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const CLOSE_MOVEMENT_KINDS = ['savings', 'provision', 'provision_payment', 'extra', 'leftover', 'cover'] as const;
export type CloseMovementKind = (typeof CLOSE_MOVEMENT_KINDS)[number];

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  initial: 'Saldo inicial',
  manual: 'Movimiento',
  transfer: 'Traspaso',
  savings: 'Ahorro del mes',
  provision: 'Apartado de provisión',
  provision_payment: 'Pago de provisión',
  extra: 'Reparto del extra',
  leftover: 'Sobrante del mes',
  cover: 'Cubrir exceso',
};

export const movementInputSchema = z.object({
  bucketId: z.int().positive(),
  /** Positivo = entra en la hucha; negativo = sale. */
  amountCents: z.int().refine((v) => v !== 0, 'El importe no puede ser 0'),
  date: isoDateSchema,
  kind: z.enum(['initial', 'manual']),
  affectsBudget: z.boolean().default(false),
  note: z.string().trim().max(200).default(''),
});
export type MovementInput = z.input<typeof movementInputSchema>;

export const transferInputSchema = z
  .object({
    fromBucketId: z.int().positive(),
    toBucketId: z.int().positive(),
    amountCents: centsSchema,
    date: isoDateSchema,
    note: z.string().trim().max(200).default(''),
  })
  .refine((t) => t.fromBucketId !== t.toBucketId, { message: 'Elige dos huchas distintas', path: ['toBucketId'] });
export type TransferInput = z.input<typeof transferInputSchema>;

export interface BucketMovement {
  id: number;
  bucketId: number;
  amountCents: number;
  date: string;
  /** Mes al que pertenece (para cierres y movimientos que afectan al mes). */
  month: string | null;
  kind: MovementKind;
  affectsBudget: boolean;
  note: string;
  createdAt: string;
}

// ---- Cierre de mes ----

export const closeMovementSchema = z.object({
  bucketId: z.int().positive(),
  amountCents: z.int().refine((v) => v !== 0),
  kind: z.enum(CLOSE_MOVEMENT_KINDS),
  note: z.string().max(200).default(''),
});
export type CloseMovement = z.input<typeof closeMovementSchema>;

export const monthCloseInputSchema = z.object({
  movements: z.array(closeMovementSchema).max(200),
  incomeCents: z.int().min(0),
  needsCents: z.int().min(0),
  wantsCents: z.int().min(0),
  savingsCents: z.int(),
});
export type MonthCloseInput = z.input<typeof monthCloseInputSchema>;

export interface MonthClose {
  month: string;
  closedAt: string;
  incomeCents: number;
  needsCents: number;
  wantsCents: number;
  savingsCents: number;
}
