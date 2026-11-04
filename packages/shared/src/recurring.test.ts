import { describe, expect, it } from 'vitest';
import {
  amountAt,
  commitmentSummary,
  isDueInMonth,
  monthlyCommitment,
  type RecurringForCalc,
} from './recurring.ts';

const casa: RecurringForCalc = {
  type: 'fixed',
  frequencyMonths: 1,
  dueMonth: null,
  startDate: '2026-01-01',
  endDate: null,
  amounts: [{ amountCents: 50000, validFrom: '2026-01-01' }],
};

const seguroCoche: RecurringForCalc = {
  type: 'provision',
  frequencyMonths: 12,
  dueMonth: 3,
  startDate: '2026-01-01',
  endDate: null,
  amounts: [{ amountCents: 60000, validFrom: '2026-01-01' }],
};

const gasolina: RecurringForCalc = {
  type: 'variable',
  frequencyMonths: 1,
  dueMonth: null,
  startDate: '2026-01-01',
  endDate: null,
  amounts: [{ amountCents: 12000, validFrom: '2026-01-01' }],
};

// Tarifa plana 80 € el primer año, luego sube.
const cuotaAutonomo: RecurringForCalc = {
  type: 'fixed',
  frequencyMonths: 1,
  dueMonth: null,
  startDate: '2026-12-01',
  endDate: null,
  amounts: [
    { amountCents: 8000, validFrom: '2026-12-01' },
    { amountCents: 30000, validFrom: '2027-12-01' },
  ],
};

describe('amountAt', () => {
  it('elige el importe vigente más reciente', () => {
    expect(amountAt(cuotaAutonomo.amounts, '2026-11-30')).toBeNull();
    expect(amountAt(cuotaAutonomo.amounts, '2027-06-15')).toBe(8000);
    expect(amountAt(cuotaAutonomo.amounts, '2027-12-01')).toBe(30000);
  });
});

describe('monthlyCommitment', () => {
  it('fijo: el importe cada mes', () => {
    expect(monthlyCommitment(casa, '2026-11')).toBe(50000);
  });

  it('provisión: la parte proporcional cada mes', () => {
    expect(monthlyCommitment(seguroCoche, '2026-11')).toBe(5000);
    expect(monthlyCommitment({ ...seguroCoche, frequencyMonths: 6, amounts: [{ amountCents: 10000, validFrom: '2026-01-01' }] }, '2026-11')).toBe(1667);
  });

  it('respeta inicio, fin y cambios de importe', () => {
    expect(monthlyCommitment(cuotaAutonomo, '2026-11')).toBe(0);
    expect(monthlyCommitment(cuotaAutonomo, '2026-12')).toBe(8000);
    expect(monthlyCommitment(cuotaAutonomo, '2027-12')).toBe(30000);
    expect(monthlyCommitment({ ...casa, endDate: '2026-10-31' }, '2026-11')).toBe(0);
  });
});

describe('isDueInMonth', () => {
  it('las provisiones solo se pagan en su mes', () => {
    expect(isDueInMonth(seguroCoche, '2027-03')).toBe(true);
    expect(isDueInMonth(seguroCoche, '2027-04')).toBe(false);
    const semestral = { ...seguroCoche, frequencyMonths: 6, dueMonth: 2 };
    expect(isDueInMonth(semestral, '2026-08')).toBe(true);
    expect(isDueInMonth(semestral, '2027-02')).toBe(true);
    expect(isDueInMonth(semestral, '2027-03')).toBe(false);
  });

  it('los fijos se pagan todos los meses activos', () => {
    expect(isDueInMonth(casa, '2026-11')).toBe(true);
    expect(isDueInMonth(cuotaAutonomo, '2026-11')).toBe(false);
  });
});

describe('commitmentSummary', () => {
  it('suma por tipo', () => {
    expect(commitmentSummary([casa, seguroCoche, gasolina, cuotaAutonomo], '2026-12')).toEqual({
      fixed: 58000,
      provision: 5000,
      variable: 12000,
      total: 75000,
    });
  });
});
