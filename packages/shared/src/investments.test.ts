import { describe, expect, it } from 'vitest';
import { computeMonthBudget } from './budget.ts';
import {
  type InvestmentAsset,
  type InvestmentOperation,
  type InvestmentValuation,
  UNITS_SCALE,
  allocation,
  formatUnits,
  investmentMonthFlows,
  parseUnits,
  portfolio,
  positionSummary,
  unitsValue,
} from './investments.ts';
import { DEFAULT_SETTINGS } from './schemas.ts';

let nextId = 1;
function op(o: Partial<InvestmentOperation> & Pick<InvestmentOperation, 'kind' | 'amountCents'>): InvestmentOperation {
  return {
    id: nextId++,
    assetId: 1,
    date: '2026-01-10',
    units: null,
    source: 'month',
    bucketId: null,
    recurringExpenseId: null,
    note: '',
    createdAt: '',
    ...o,
  };
}
const val = (date: string, valueCents: number, assetId = 1): InvestmentValuation => ({ id: nextId++, assetId, date, valueCents });

describe('participaciones', () => {
  it('parsea con coma o punto y hasta 8 decimales', () => {
    expect(parseUnits('12,5')).toBe(12.5 * UNITS_SCALE);
    expect(parseUnits('0.00012345')).toBe(12345);
    expect(parseUnits('3')).toBe(3 * UNITS_SCALE);
    expect(parseUnits('1,123456789')).toBeNull();
    expect(parseUnits('0')).toBeNull();
    expect(parseUnits('-1')).toBeNull();
    expect(parseUnits('abc')).toBeNull();
  });

  it('formatea sin ceros sobrantes', () => {
    expect(formatUnits(12.5 * UNITS_SCALE)).toBe('12,5');
    expect(formatUnits(12345)).toBe('0,00012345');
    expect(formatUnits(3 * UNITS_SCALE)).toBe('3');
  });

  it('calcula el valor a un precio', () => {
    expect(unitsValue(parseUnits('10,5')!, 2345)).toBe(24623); // 10,5 × 23,45 € = 246,225 €
  });
});

describe('positionSummary', () => {
  it('sin valoración, el valor es lo aportado neto (estimado)', () => {
    const s = positionSummary([op({ kind: 'contribution', amountCents: 100_00 })], []);
    expect(s).toMatchObject({ contributed: 100_00, netContributed: 100_00, value: 100_00, valueIsEstimate: true, gain: 0 });
  });

  it('con valoración, calcula ganancia y %', () => {
    const s = positionSummary(
      [op({ kind: 'contribution', amountCents: 1000_00 }), op({ kind: 'contribution', amountCents: 200_00, date: '2026-02-10' })],
      [val('2026-03-01', 1320_00)],
    );
    expect(s).toMatchObject({ value: 1320_00, valueIsEstimate: false, gain: 120_00, gainPct: 10, valuedAt: '2026-03-01' });
  });

  it('entre valoraciones suma lo aportado y resta lo retirado después', () => {
    const s = positionSummary(
      [
        op({ kind: 'contribution', amountCents: 1000_00, date: '2026-01-10' }),
        op({ kind: 'contribution', amountCents: 100_00, date: '2026-02-10' }),
        op({ kind: 'withdrawal', amountCents: 50_00, date: '2026-02-20' }),
      ],
      [val('2026-02-01', 1100_00)],
    );
    expect(s.value).toBe(1150_00);
    expect(s.valueIsEstimate).toBe(true);
    expect(s.gain).toBe(1150_00 + 50_00 - 1100_00);
  });

  it('la valoración de un día incluye las operaciones de ese día', () => {
    const s = positionSummary(
      [op({ kind: 'contribution', amountCents: 100_00, date: '2026-03-01' })],
      [val('2026-03-01', 101_00)],
    );
    expect(s.value).toBe(101_00);
    expect(s.valueIsEstimate).toBe(false);
  });

  it('usa la valoración más reciente aunque llegue desordenada', () => {
    const s = positionSummary([op({ kind: 'contribution', amountCents: 100_00 })], [val('2026-05-01', 130_00), val('2026-03-01', 90_00)]);
    expect(s.value).toBe(130_00);
  });

  it('las retiradas y los dividendos cobrados cuentan como ganancia; los reinvertidos no', () => {
    const s = positionSummary(
      [
        op({ kind: 'contribution', amountCents: 1000_00 }),
        op({ kind: 'withdrawal', amountCents: 300_00, date: '2026-02-01' }),
        op({ kind: 'dividend', amountCents: 20_00, date: '2026-02-01', source: 'bucket', bucketId: 3 }),
        op({ kind: 'dividend', amountCents: 15_00, date: '2026-02-01', source: 'none' }),
      ],
      [val('2026-03-01', 800_00)],
    );
    expect(s).toMatchObject({ netContributed: 700_00, dividendsPaidOut: 20_00, dividendsReinvested: 15_00 });
    expect(s.gain).toBe(800_00 + 300_00 + 20_00 - 1000_00);
  });

  it('solo restan las comisiones pagadas aparte', () => {
    const s = positionSummary(
      [
        op({ kind: 'contribution', amountCents: 1000_00 }),
        op({ kind: 'fee', amountCents: 5_00, source: 'month' }),
        op({ kind: 'fee', amountCents: 3_00, source: 'none' }),
      ],
      [val('2026-03-01', 1000_00)],
    );
    expect(s).toMatchObject({ feesPaid: 5_00, feesInside: 3_00, gain: -5_00 });
  });

  it('a una fecha ignora lo posterior', () => {
    const ops = [op({ kind: 'contribution', amountCents: 100_00, date: '2026-01-10' }), op({ kind: 'contribution', amountCents: 50_00, date: '2026-04-10' })];
    const s = positionSummary(ops, [val('2026-02-01', 110_00), val('2026-05-01', 170_00)], '2026-03-31');
    expect(s).toMatchObject({ contributed: 100_00, value: 110_00 });
  });

  it('cuenta participaciones solo si están en todas las compras y ventas', () => {
    const units = (n: string) => parseUnits(n);
    const full = positionSummary(
      [
        op({ kind: 'contribution', amountCents: 100_00, units: units('10') }),
        op({ kind: 'withdrawal', amountCents: 20_00, units: units('2,5') }),
      ],
      [],
    );
    expect(full.units).toBe(units('7,5'));
    const partial = positionSummary(
      [op({ kind: 'contribution', amountCents: 100_00, units: units('10') }), op({ kind: 'contribution', amountCents: 10_00 })],
      [],
    );
    expect(partial.units).toBeNull();
  });

  it('el valor nunca es negativo', () => {
    const s = positionSummary([op({ kind: 'withdrawal', amountCents: 500_00, date: '2026-02-01' })], [val('2026-01-01', 100_00)]);
    expect(s.value).toBe(0);
  });
});

describe('portfolio y allocation', () => {
  const asset = (id: number, o: Partial<InvestmentAsset> = {}): InvestmentAsset => ({
    id,
    accountId: 1,
    name: `Activo ${id}`,
    ticker: '',
    type: 'index_fund',
    assetClass: 'equity',
    region: 'global',
    archived: false,
    ...o,
  });

  const data = {
    accounts: [{ id: 1, name: 'Bróker', archived: false }],
    assets: [asset(1, { region: 'us' }), asset(2, { assetClass: 'fixed_income', region: 'europe' }), asset(3, { assetClass: 'crypto', region: 'other' })],
    operations: [
      op({ assetId: 1, kind: 'contribution', amountCents: 600_00 }),
      op({ assetId: 2, kind: 'contribution', amountCents: 300_00 }),
      op({ assetId: 3, kind: 'contribution', amountCents: 100_00 }),
    ],
    valuations: [val('2026-02-01', 700_00, 1), val('2026-02-01', 300_00, 2), val('2026-02-01', 0, 3)],
  };

  it('suma las posiciones y ordena por valor', () => {
    const p = portfolio(data);
    expect(p.positions.map((x) => x.asset.id)).toEqual([1, 2, 3]);
    expect(p.total).toMatchObject({ contributed: 1000_00, value: 1000_00, gain: 0, gainPct: 0 });
  });

  it('reparte por clase sin contar lo que vale 0', () => {
    const slices = allocation(portfolio(data).positions, (p) => p.asset.assetClass);
    expect(slices).toEqual([
      { key: 'equity', value: 700_00, pct: 70 },
      { key: 'fixed_income', value: 300_00, pct: 30 },
    ]);
  });
});

describe('investmentMonthFlows y presupuesto', () => {
  const ops = [
    op({ kind: 'contribution', amountCents: 100_00, date: '2026-03-05' }),
    op({ kind: 'withdrawal', amountCents: 40_00, date: '2026-03-20' }),
    op({ kind: 'contribution', amountCents: 999_00, date: '2026-03-06', source: 'bucket', bucketId: 2 }),
    op({ kind: 'contribution', amountCents: 999_00, date: '2026-03-07', source: 'none' }),
    op({ kind: 'contribution', amountCents: 999_00, date: '2026-04-01' }),
    op({ kind: 'contribution', amountCents: 999_00, date: '2026-03-08', recurringExpenseId: 9 }),
  ];

  it('solo cuenta lo del mes que sale o vuelve al dinero del mes', () => {
    expect(investmentMonthFlows(ops, '2026-03')).toEqual([{ amountCents: 100_00 }, { amountCents: -40_00 }]);
  });

  it('resta del disponible lo aportado desde el mes', () => {
    const budget = computeMonthBudget({
      month: '2026-03',
      today: '2026-03-15',
      settings: { ...DEFAULT_SETTINGS, referenceIncomeCents: 1000_00 },
      incomes: [{ amountCents: 1000_00 }],
      expenses: [],
      recurring: [],
      investmentFlows: investmentMonthFlows(ops, '2026-03'),
    });
    expect(budget.spent.toInvestments).toBe(60_00);
    expect(budget.spendable).toBe(940_00);
    expect(budget.remaining).toBe(940_00);
  });
});
