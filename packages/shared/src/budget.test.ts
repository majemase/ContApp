import { describe, expect, it } from 'vitest';
import {
  type BudgetExpense,
  type BudgetInput,
  type BudgetRecurring,
  computeMonthBudget,
  monthlySavings,
} from './budget.ts';
import type { Settings } from './schemas.ts';

const rec = (r: Partial<BudgetRecurring> & Pick<BudgetRecurring, 'id' | 'type'>, amount: number): BudgetRecurring => ({
  name: `r${r.id}`,
  categoryId: null,
  dueDay: null,
  frequencyMonths: 1,
  dueMonth: null,
  startDate: '2026-01-01',
  endDate: null,
  amounts: [{ amountCents: amount, validFrom: '2026-01-01' }],
  ...r,
});

const CASA = rec({ id: 1, type: 'fixed', name: 'Casa', categoryId: 10, dueDay: 1 }, 50000);
const SEGURO = rec({ id: 2, type: 'provision', name: 'Seguro', categoryId: 11, frequencyMonths: 12, dueMonth: 3 }, 60000);
const GASOLINA = rec({ id: 3, type: 'variable', name: 'Gasolina', categoryId: 12 }, 12000);
const OCIO = 13;

let nextId = 1;
const gasto = (amountCents: number, extra: Partial<BudgetExpense> = {}): BudgetExpense => ({
  id: nextId++,
  date: '2026-11-04',
  amountCents,
  categoryId: null,
  recurringExpenseId: null,
  ...extra,
});

const base = (over: Partial<BudgetInput> = {}): BudgetInput => ({
  month: '2026-11',
  today: '2026-11-11',
  settings: { referenceIncomeCents: 100000, savingsMode: 'fixed', minSavingsCents: 5000, savingsPct: 0, healthThresholdPct: 70 },
  incomes: [],
  expenses: [],
  recurring: [CASA, SEGURO, GASOLINA],
  ...over,
});

describe('ingresos', () => {
  it('sin ingresos apuntados usa la referencia como estimación', () => {
    const b = computeMonthBudget(base());
    expect(b.income).toEqual({ actual: 0, reference: 100000, base: 100000, estimated: true, extra: 0 });
  });

  it('lo cobrado por encima de la referencia es extra y no se presupuesta', () => {
    const b = computeMonthBudget(base({ incomes: [{ amountCents: 100000 }, { amountCents: 40000 }] }));
    expect(b.income.base).toBe(100000);
    expect(b.income.extra).toBe(40000);
  });

  it('un mes malo presupuesta con lo cobrado', () => {
    const b = computeMonthBudget(base({ incomes: [{ amountCents: 90000 }] }));
    expect(b.income.base).toBe(90000);
    expect(b.income.extra).toBe(0);
  });

  it('sin referencia, se usa todo lo cobrado', () => {
    const b = computeMonthBudget(
      base({ settings: { referenceIncomeCents: null, savingsMode: 'fixed', minSavingsCents: 0, savingsPct: 0, healthThresholdPct: 70 }, incomes: [{ amountCents: 150000 }] }),
    );
    expect(b.income.base).toBe(150000);
    expect(b.income.extra).toBe(0);
  });
});

describe('disponible y restante', () => {
  it('descuenta fijos, provisiones, variables y ahorro mínimo', () => {
    // 1000 − 500 − 50 − 120 − 50 = 280
    expect(computeMonthBudget(base()).available).toBe(28000);
  });

  it('el gasto libre resta del disponible', () => {
    const b = computeMonthBudget(base({ expenses: [gasto(150, { categoryId: OCIO }), gasto(4500)] }));
    expect(b.spent.free).toBe(4650);
    expect(b.remaining).toBe(28000 - 4650);
  });

  it('la gasolina cuenta contra su presupuesto; solo el exceso resta', () => {
    const dentro = computeMonthBudget(base({ expenses: [gasto(6000, { categoryId: 12 })] }));
    expect(dentro.variables[0]).toMatchObject({ budget: 12000, spent: 6000 });
    expect(dentro.remaining).toBe(28000);

    const pasado = computeMonthBudget(base({ expenses: [gasto(9000, { categoryId: 12 }), gasto(5000, { categoryId: 12 })] }));
    expect(pasado.spent.variableOverspend).toBe(2000);
    expect(pasado.remaining).toBe(26000);
  });

  it('pagar un fijo no resta (ya estaba comprometido), salvo lo que supere lo previsto', () => {
    const exacto = computeMonthBudget(base({ expenses: [gasto(50000, { recurringExpenseId: 1, categoryId: 10 })] }));
    expect(exacto.remaining).toBe(28000);
    expect(exacto.dues.find((d) => d.id === 1)).toMatchObject({ isPaid: true, paid: 50000 });

    const mas = computeMonthBudget(base({ expenses: [gasto(52000, { recurringExpenseId: 1 })] }));
    expect(mas.spent.fixedOverrun).toBe(2000);
    expect(mas.remaining).toBe(26000);
  });

  it('el pago de una provisión sale de lo apartado', () => {
    const b = computeMonthBudget(
      base({ month: '2027-03', today: '2027-03-10', expenses: [gasto(60000, { recurringExpenseId: 2, date: '2027-03-05' })] }),
    );
    expect(b.spent.fromProvisions).toBe(60000);
    expect(b.remaining).toBe(28000);
    expect(b.dues.find((d) => d.id === 2)).toMatchObject({ amount: 60000, isPaid: true });
  });
});

describe('pendientes de pago', () => {
  it('incluye fijos y las provisiones solo en su mes', () => {
    expect(computeMonthBudget(base()).dues.map((d) => d.name)).toEqual(['Casa']);
    expect(computeMonthBudget(base({ month: '2027-03', today: '2027-03-01' })).dues.map((d) => d.name)).toEqual([
      'Casa',
      'Seguro',
    ]);
  });
});

describe('días y ritmo', () => {
  it('reparte lo que queda entre los días restantes (incluido hoy)', () => {
    const b = computeMonthBudget(base({ expenses: [gasto(4000)] }));
    expect(b.daysLeft).toBe(20); // del 11 al 30
    expect(b.dailyAllowance).toBe(Math.floor(24000 / 20));
  });

  it('avisa si vas por encima del ritmo', () => {
    // Día 11 de 30: lo "justo" sería 280 × 11/30 ≈ 102,67 €
    expect(computeMonthBudget(base({ expenses: [gasto(9000)] })).pace.status).toBe('ok');
    expect(computeMonthBudget(base({ expenses: [gasto(12000)] })).pace.status).toBe('over');
  });

  it('meses pasados y futuros', () => {
    expect(computeMonthBudget(base({ month: '2026-10' })).daysLeft).toBeNull();
    expect(computeMonthBudget(base({ month: '2026-12' })).daysLeft).toBe(31);
  });

  it('si te has pasado, 0 €/día', () => {
    expect(computeMonthBudget(base({ expenses: [gasto(40000)] })).dailyAllowance).toBe(0);
  });
});

describe('salud del presupuesto', () => {
  it('compara lo comprometido + ahorro con la referencia', () => {
    // (670 + 50) / 1000 = 72 % > 70 %
    const b = computeMonthBudget(base());
    expect(b.health).toEqual({ ratioPct: 72, thresholdPct: 70, status: 'warning' });
  });

  it('crítico si lo comprometido supera el ingreso', () => {
    const cuota = rec({ id: 4, type: 'fixed' }, 30000);
    expect(computeMonthBudget(base({ recurring: [CASA, SEGURO, GASOLINA, cuota] })).health.status).toBe('critical');
  });
});

describe('ahorro', () => {
  const ajustes = (over: Partial<Settings>): Settings => ({
    referenceIncomeCents: 100000,
    savingsMode: 'fixed',
    minSavingsCents: 5000,
    savingsPct: 15,
    healthThresholdPct: 70,
    ...over,
  });

  it('importe fijo', () => {
    expect(monthlySavings(ajustes({ savingsMode: 'fixed' }), 100000)).toBe(5000);
  });

  it('porcentaje de la base', () => {
    expect(monthlySavings(ajustes({ savingsMode: 'percent' }), 100000)).toBe(15000);
    expect(monthlySavings(ajustes({ savingsMode: 'percent' }), 0)).toBe(0);
  });

  it('lo mayor: el fijo hace de suelo en los meses malos', () => {
    expect(monthlySavings(ajustes({ savingsMode: 'max' }), 100000)).toBe(15000);
    expect(monthlySavings(ajustes({ savingsMode: 'max' }), 20000)).toBe(5000);
  });

  it('el % se aplica a la base, no al extra', () => {
    // Cobra 1.400 con referencia 1.000: 15 % de 1.000, no de 1.400.
    const b = computeMonthBudget(
      base({ settings: ajustes({ savingsMode: 'percent' }), incomes: [{ amountCents: 140000 }] }),
    );
    expect(b.savings).toBe(15000);
    expect(b.available).toBe(100000 - 67000 - 15000);
  });
});
