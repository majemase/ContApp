import { describe, expect, it } from 'vitest';
import { centsToInput, formatEuros, parseEuros } from './money.ts';

describe('parseEuros', () => {
  it.each([
    ['1,50', 150],
    ['1.50', 150],
    ['1,5', 150],
    ['2', 200],
    ['2 €', 200],
    ['1.000', 100000],
    ['12.500', 1250000],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['0,05', 5],
    ['-3,20', -320],
  ])('%s → %i', (input, expected) => {
    expect(parseEuros(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234', '1,2,3', '1.5.5', '1,505'])('rechaza %j', (input) => {
    expect(parseEuros(input)).toBeNull();
  });
});

describe('formatEuros / centsToInput', () => {
  it('formatea en español', () => {
    expect(formatEuros(150)).toBe('1,50 €');
    expect(formatEuros(123456)).toBe('1.234,56 €');
  });

  it('prepara el valor de un input', () => {
    expect(centsToInput(150)).toBe('1,50');
    expect(centsToInput(5)).toBe('0,05');
    expect(centsToInput(50000)).toBe('500,00');
  });
});
