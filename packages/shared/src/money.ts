// Todos los importes de la app son enteros en céntimos. Nunca usar float para dinero.

const euroFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
});

/** 150 → "1,50 €" */
export function formatEuros(cents: number): string {
  return euroFormatter.format(cents / 100);
}

/** 150 → "1,50" (para rellenar inputs de edición) */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${euros},${rest}`;
}

/**
 * Convierte lo que escribe el usuario en céntimos.
 * Acepta "1,50", "1.50", "1.234,56", "1,234.56", "1000", "1.000", "2 €".
 * Devuelve null si no es un importe válido (máx. 2 decimales).
 */
export function parseEuros(input: string): number | null {
  let s = input.replace(/[\s€]/g, '');
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // El último separador es el decimal; el otro, de miles.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  } else if (lastDot !== -1 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.000" o "12.500": puntos como separador de miles.
    s = s.split('.').join('');
  }

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;

  const [, sign, intPart, decPart = ''] = match;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}
