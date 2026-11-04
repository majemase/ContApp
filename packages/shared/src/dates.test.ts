import { describe, expect, it } from 'vitest';
import { addMonths, daysInMonth, monthBounds } from './dates.ts';

describe('dates', () => {
  it('addMonths cruza años', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 12)).toBe('2027-11');
  });

  it('límites del mes', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });
});
