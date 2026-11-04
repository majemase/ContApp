import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

export const ledgers = sqliteTable('ledgers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'business'] }).notNull(),
  createdAt: createdAt(),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ledgerId: integer('ledger_id')
    .notNull()
    .references(() => ledgers.id),
  name: text('name').notNull(),
  icon: text('icon').notNull().default(''),
  color: text('color').notNull().default('slate'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const recurringExpenses = sqliteTable('recurring_expenses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ledgerId: integer('ledger_id')
    .notNull()
    .references(() => ledgers.id),
  categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['fixed', 'provision', 'variable'] }).notNull(),
  frequencyMonths: integer('frequency_months').notNull().default(1),
  dueMonth: integer('due_month'),
  dueDay: integer('due_day'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  notes: text('notes').notNull().default(''),
  createdAt: createdAt(),
});

export const recurringExpenseAmounts = sqliteTable(
  'recurring_expense_amounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recurringExpenseId: integer('recurring_expense_id')
      .notNull()
      .references(() => recurringExpenses.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    validFrom: text('valid_from').notNull(),
  },
  (t) => [uniqueIndex('recurring_amount_unique').on(t.recurringExpenseId, t.validFrom)],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    date: text('date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    note: text('note').notNull().default(''),
    impulsive: integer('impulsive', { mode: 'boolean' }).notNull().default(false),
    recurringExpenseId: integer('recurring_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('expenses_ledger_date').on(t.ledgerId, t.date)],
);

export const incomes = sqliteTable(
  'incomes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    date: text('date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    type: text('type', { enum: ['salary', 'allowance', 'bonus', 'arrears', 'refund', 'other'] }).notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('incomes_ledger_date').on(t.ledgerId, t.date)],
);

/** Ajustes de presupuesto, uno por ámbito. */
export const ledgerSettings = sqliteTable('ledger_settings', {
  ledgerId: integer('ledger_id')
    .primaryKey()
    .references(() => ledgers.id),
  referenceIncomeCents: integer('reference_income_cents'),
  savingsMode: text('savings_mode', { enum: ['fixed', 'percent', 'max'] }).notNull().default('fixed'),
  minSavingsCents: integer('min_savings_cents').notNull().default(0),
  savingsPct: integer('savings_pct').notNull().default(0),
  savingsBucketId: integer('savings_bucket_id').references(() => buckets.id),
  /** JSON: [{ bucketId: number | null, pct: number }]. bucketId null = parte libre. */
  extraRules: text('extra_rules').notNull().default('[]'),
  /** JSON, igual que extra_rules. Vacío = mismo reparto que el extra. */
  oneOffRules: text('one_off_rules').notNull().default('[]'),
  targetNeedsPct: integer('target_needs_pct').notNull().default(50),
  targetWantsPct: integer('target_wants_pct').notNull().default(30),
  targetSavingsPct: integer('target_savings_pct').notNull().default(20),
  healthThresholdPct: integer('health_threshold_pct').notNull().default(70),
});

export const buckets = sqliteTable('buckets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ledgerId: integer('ledger_id')
    .notNull()
    .references(() => ledgers.id),
  name: text('name').notNull(),
  icon: text('icon').notNull().default(''),
  type: text('type', { enum: ['savings', 'emergency', 'cushion', 'goal', 'provision'] }).notNull(),
  targetCents: integer('target_cents'),
  /** Solo en huchas de provisión: el gasto recurrente que alimentan. */
  recurringExpenseId: integer('recurring_expense_id')
    .unique()
    .references(() => recurringExpenses.id, { onDelete: 'set null' }),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const bucketMovements = sqliteTable(
  'bucket_movements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    bucketId: integer('bucket_id')
      .notNull()
      .references(() => buckets.id),
    /** Positivo = entra en la hucha; negativo = sale. */
    amountCents: integer('amount_cents').notNull(),
    date: text('date').notNull(),
    month: text('month'),
    kind: text('kind', {
      enum: ['initial', 'manual', 'transfer', 'savings', 'provision', 'provision_payment', 'extra', 'leftover', 'cover'],
    }).notNull(),
    affectsBudget: integer('affects_budget', { mode: 'boolean' }).notNull().default(false),
    note: text('note').notNull().default(''),
    /** Une los dos movimientos de un traspaso entre huchas. */
    groupId: text('group_id'),
    createdAt: createdAt(),
  },
  (t) => [index('movements_bucket').on(t.bucketId), index('movements_ledger_month').on(t.ledgerId, t.month)],
);

/** Meses cerrados, con la foto del medidor de reparto. */
export const monthCloses = sqliteTable(
  'month_closes',
  {
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    month: text('month').notNull(),
    closedAt: createdAt(),
    incomeCents: integer('income_cents').notNull(),
    needsCents: integer('needs_cents').notNull(),
    wantsCents: integer('wants_cents').notNull(),
    savingsCents: integer('savings_cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ledgerId, t.month] })],
);
