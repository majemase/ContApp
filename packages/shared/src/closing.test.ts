import { describe, expect, it } from 'vitest';
import { type BudgetExpense, type BudgetInput, type BudgetRecurring, computeMonthBudget } from './budget.ts';
import { monthMeter, proposeClose } from './closing.ts';
import type { Bucket, Settings } from './schemas.ts';

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

const CASA = rec({ id: 1, type: 'fixed', name: 'Casa', categoryId: 10 }, 50000);
const SEGURO = rec({ id: 2, type: 'provision', name: 'Seguro', frequencyMonths: 12, dueMonth: 3 }, 60000);
const GASOLINA = rec({ id: 3, type: 'variable', name: 'Gasolina', categoryId: 12 }, 12000);

const bucket = (id: number, over: Partial<Bucket> = {}): Bucket => ({
  id,
  ledgerId: 1,
  name: `b${id}`,
  icon: '',
  type: 'savings',
  targetCents: null,
  recurringExpenseId: null,
  archived: false,
  balanceCents: 0,
  ...over,
});
const EMERGENCIA = 1;
const COLCHON = 2;
const AHORRO = 3;
const BUCKETS = [
  bucket(EMERGENCIA, { type: 'emergency' }),
  bucket(COLCHON, { type: 'cushion' }),
  bucket(AHORRO),
  bucket(4, { type: 'provision', recurringExpenseId: SEGURO.id }),
];

const SETTINGS: Settings = {
  referenceIncomeCents: 100000,
  savingsMode: 'fixed',
  minSavingsCents: 5000,
  savingsPct: 0,
  savingsBucketId: AHORRO,
  extraRules: [
    { bucketId: EMERGENCIA, pct: 40 },
    { bucketId: COLCHON, pct: 30 },
    { bucketId: AHORRO, pct: 20 },
    { bucketId: null, pct: 10 },
  ],
  oneOffRules: [],
  healthThresholdPct: 70,
  targetNeedsPct: 50,
  targetWantsPct: 30,
  targetSavingsPct: 20,
};

let nextId = 1;
const gasto = (amountCents: number, extra: Partial<BudgetExpense> = {}): BudgetExpense => ({
  id: nextId++,
  date: '2026-11-10',
  amountCents,
  categoryId: null,
  recurringExpenseId: null,
  ...extra,
});

const input = (over: Partial<BudgetInput> = {}): BudgetInput => ({
  month: '2026-11',
  today: '2026-12-01',
  settings: SETTINGS,
  incomes: [{ amountCents: 100000 }, { amountCents: 40000 }],
  expenses: [gasto(50000, { recurringExpenseId: CASA.id }), gasto(9000, { categoryId: 12 }), gasto(6000)],
  recurring: [CASA, SEGURO, GASOLINA],
  ...over,
});

const close = (i: BudgetInput, leftover = AHORRO, cover = COLCHON) =>
  proposeClose({ budget: computeMonthBudget(i), settings: i.settings, buckets: BUCKETS, leftoverBucketId: leftover, coverBucketId: cover });

/** Todo lo cobrado acaba gastado o en una hucha. */
function expectMoneyBalances(i: BudgetInput) {
  const { movements } = close(i);
  const intoBuckets = movements.reduce((s, m) => s + m.amountCents, 0);
  const manual = (i.budgetMovements ?? []).reduce((s, m) => s + m.amountCents, 0);
  const income = i.incomes.reduce((s, x) => s + x.amountCents, 0);
  const spent = i.expenses.reduce((s, e) => s + e.amountCents, 0);
  expect(intoBuckets + manual).toBe(income - spent);
}

describe('parte libre del extra', () => {
  it('se suma a lo disponible del mes', () => {
    const b = computeMonthBudget(input());
    expect(b.income.extraFree).toBe(4000); // 10 % de 400 €
    // 1000 + 40 − 500 − 50 − 120 − 50
    expect(b.available).toBe(32000);
  });
});

describe('movimientos manuales del mes', () => {
  it('meter dinero en una hucha reduce lo que queda; sacarlo lo aumenta', () => {
    expect(computeMonthBudget(input({ budgetMovements: [{ amountCents: 3000 }] })).remaining).toBe(
      computeMonthBudget(input()).remaining - 3000,
    );
    expect(computeMonthBudget(input({ budgetMovements: [{ amountCents: -10000 }] })).remaining).toBe(
      computeMonthBudget(input()).remaining + 10000,
    );
  });
});

describe('sobrante', () => {
  it('incluye lo no gastado de los presupuestos variables', () => {
    const b = computeMonthBudget(input());
    expect(b.variableSurplus).toBe(3000); // gasolina: 120 − 90
    expect(b.leftover).toBe(b.remaining + 3000);
  });
});

describe('proposeClose', () => {
  it('genera los movimientos del mes', () => {
    const { movements, problems } = close(input());
    expect(problems).toEqual([]);
    expect(movements.map((m) => [m.kind, m.bucketId, m.amountCents])).toEqual([
      ['savings', AHORRO, 5000],
      ['provision', 4, 5000],
      ['extra', EMERGENCIA, 16000], // 360 € a huchas: 40/90, 30/90, 20/90
      ['extra', COLCHON, 12000],
      ['extra', AHORRO, 8000],
      // 320 disponible − 60 libre + 30 sin gastar de gasolina
      ['leftover', AHORRO, 29000],
    ]);
  });

  it('el pago de una provisión sale de su hucha', () => {
    const i = input({ month: '2027-03', expenses: [gasto(50000, { recurringExpenseId: 1 }), gasto(60000, { recurringExpenseId: 2 })] });
    const prov = close(i).movements.filter((m) => m.bucketId === 4);
    expect(prov.map((m) => [m.kind, m.amountCents])).toEqual([
      ['provision', 5000],
      ['provision_payment', -60000],
    ]);
  });

  it('si te pasas, el exceso se cubre desde la hucha elegida', () => {
    const { movements } = close(input({ expenses: [gasto(50000, { recurringExpenseId: 1 }), gasto(50000)] }));
    const cover = movements.find((m) => m.kind === 'cover');
    expect(cover).toMatchObject({ bucketId: COLCHON });
    expect(cover!.amountCents).toBeLessThan(0);
  });

  it('avisa de lo que falta', () => {
    const sinHucha = proposeClose({
      budget: computeMonthBudget(input()),
      settings: { ...SETTINGS, savingsBucketId: null },
      buckets: BUCKETS,
      leftoverBucketId: null,
      coverBucketId: null,
    });
    expect(sinHucha.problems).toHaveLength(2);
    expect(close(input({ incomes: [] })).problems[0]).toMatch(/ningún ingreso/);
    expect(close(input({ expenses: [] })).warnings[0]).toMatch(/Casa/);
  });

  describe('el dinero cuadra', () => {
    it('mes normal con extra', () => expectMoneyBalances(input()));
    it('mes con pago de provisión', () =>
      expectMoneyBalances(
        input({ month: '2027-03', expenses: [gasto(50000, { recurringExpenseId: 1 }), gasto(60000, { recurringExpenseId: 2 }), gasto(2000)] }),
      ));
    it('mes en el que te pasas', () =>
      expectMoneyBalances(input({ expenses: [gasto(50000, { recurringExpenseId: 1 }), gasto(20000, { categoryId: 12 }), gasto(40000)] })));
    it('mes malo (cobras menos que la referencia)', () =>
      expectMoneyBalances(input({ incomes: [{ amountCents: 95000 }] })));
    it('con dinero movido a huchas durante el mes', () =>
      expectMoneyBalances(input({ budgetMovements: [{ amountCents: 5000 }, { amountCents: -20000 }] })));
    it('sin referencia', () =>
      expectMoneyBalances(input({ settings: { ...SETTINGS, referenceIncomeCents: null } })));
  });
});

describe('monthMeter', () => {
  it('reparte lo cobrado en necesidades, deseos y ahorro', () => {
    const m = monthMeter(computeMonthBudget(input()));
    expect(m.income).toBe(140000);
    expect(m.needs).toBe(50000 + 5000 + 9000); // casa + provisión + gasolina gastada
    expect(m.wants).toBe(6000);
    expect(m.savings).toBe(140000 - 64000 - 6000);
    expect(m.pct).toEqual({ needs: 46, wants: 4, savings: 50 });
  });
});

describe('ingresos puntuales (atrasos, devoluciones)', () => {
  // Nómina 1.000 + dietas 400 + atrasos 600 → extra 1.000, de los que 600 son puntuales.
  const conAtrasos = (settings: Settings) =>
    input({
      settings,
      incomes: [
        { amountCents: 100000, type: 'salary' },
        { amountCents: 40000, type: 'allowance' },
        { amountCents: 60000, type: 'arrears' },
      ],
    });

  it('sin reglas propias, usan las del extra', () => {
    const b = computeMonthBudget(conAtrasos(SETTINGS));
    expect(b.income).toMatchObject({ extra: 100000, extraOneOff: 60000, extraFree: 10000 });
  });

  it('con reglas propias, cada parte se reparte con las suyas', () => {
    const settings: Settings = { ...SETTINGS, oneOffRules: [{ bucketId: AHORRO, pct: 80 }, { bucketId: null, pct: 20 }] };
    const i = conAtrasos(settings);
    const b = computeMonthBudget(i);
    // Libre: 10 % de 400 (regular) + 20 % de 600 (puntual)
    expect(b.income.extraFree).toBe(4000 + 12000);
    const extra = close(i).movements.filter((m) => m.kind === 'extra');
    expect(extra.map((m) => [m.bucketId, m.amountCents, m.note])).toEqual([
      [EMERGENCIA, 16000, 'Extra (40 %)'],
      [COLCHON, 12000, 'Extra (30 %)'],
      [AHORRO, 8000, 'Extra (20 %)'],
      [AHORRO, 48000, 'Puntual (80 %)'],
    ]);
    expectMoneyBalances(i);
  });

  it('si un mes cobras menos, los atrasos completan la referencia antes de contar como extra', () => {
    const b = computeMonthBudget(
      input({ incomes: [{ amountCents: 90000, type: 'salary' }, { amountCents: 30000, type: 'arrears' }] }),
    );
    expect(b.income).toMatchObject({ base: 100000, extra: 20000, extraOneOff: 20000 });
  });
});
