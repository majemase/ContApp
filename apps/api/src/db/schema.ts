import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    type: text('type', { enum: ['salary', 'allowance', 'bonus', 'arrears', 'other'] }).notNull(),
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
  minSavingsCents: integer('min_savings_cents').notNull().default(0),
  healthThresholdPct: integer('health_threshold_pct').notNull().default(70),
});
