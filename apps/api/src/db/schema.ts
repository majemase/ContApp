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
  /** Solo en recurrentes de tipo inversión (aportación periódica): el activo al que se aporta. */
  investmentAssetId: integer('investment_asset_id').references(() => investmentAssets.id, { onDelete: 'set null' }),
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
      enum: ['initial', 'manual', 'transfer', 'investment', 'savings', 'provision', 'provision_payment', 'extra', 'leftover', 'cover'],
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

/** Usuarios de la app. `sub` es el identificador del IdP; el email solo es informativo. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sub: text('sub').notNull().unique(),
  email: text('email'),
  name: text('name'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
});

export const ledgerMembers = sqliteTable(
  'ledger_members',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    ledgerId: integer('ledger_id')
      .references(() => ledgers.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ledgerId] }),
    index('ledger_members_ledger').on(t.ledgerId),
  ],
);

// ---- Inversiones ----

/** Dónde está invertido el dinero: un bróker, una gestora, un exchange… */
export const investmentAccounts = sqliteTable('investment_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ledgerId: integer('ledger_id')
    .notNull()
    .references(() => ledgers.id),
  name: text('name').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

/** Lo que hay dentro de una cuenta: un fondo, un ETF, una acción… */
export const investmentAssets = sqliteTable(
  'investment_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    accountId: integer('account_id')
      .notNull()
      .references(() => investmentAccounts.id),
    name: text('name').notNull(),
    ticker: text('ticker').notNull().default(''),
    type: text('type', {
      enum: ['index_fund', 'fund', 'etf', 'stock', 'crypto', 'pension', 'deposit', 'other'],
    }).notNull(),
    assetClass: text('asset_class', { enum: ['equity', 'fixed_income', 'money_market', 'crypto', 'other'] }).notNull(),
    region: text('region', { enum: ['global', 'us', 'europe', 'spain', 'emerging', 'other'] }).notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('investment_assets_account').on(t.accountId)],
);

/** Aportaciones, retiradas, dividendos y comisiones. */
export const investmentOperations = sqliteTable(
  'investment_operations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    assetId: integer('asset_id')
      .notNull()
      .references(() => investmentAssets.id),
    date: text('date').notNull(),
    kind: text('kind', { enum: ['contribution', 'withdrawal', 'dividend', 'fee'] }).notNull(),
    /** Siempre positivo; el sentido lo da `kind`. */
    amountCents: integer('amount_cents').notNull(),
    /** Participaciones × 10⁸ (opcional). */
    units: integer('units'),
    source: text('source', { enum: ['month', 'bucket', 'none'] }).notNull(),
    /** Si el dinero sale o va a una hucha: el movimiento que se creó en ella. */
    bucketMovementId: integer('bucket_movement_id').references(() => bucketMovements.id),
    /** Si la generó una aportación periódica. */
    recurringExpenseId: integer('recurring_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('investment_operations_asset').on(t.assetId),
    index('investment_operations_ledger_date').on(t.ledgerId, t.date),
  ],
);

/** Valor total de un activo en una fecha, apuntado a mano. */
export const investmentValuations = sqliteTable(
  'investment_valuations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ledgerId: integer('ledger_id')
      .notNull()
      .references(() => ledgers.id),
    assetId: integer('asset_id')
      .notNull()
      .references(() => investmentAssets.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    valueCents: integer('value_cents').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('investment_valuations_asset_date').on(t.assetId, t.date)],
);
