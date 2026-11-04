// Días como 'YYYY-MM-DD' y meses como 'YYYY-MM', siempre en hora local.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** '2026-11-04' → '2026-11' */
export function toMonth(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function parseMonth(month: string): { year: number; month: number } {
  const [y, m] = month.split('-').map(Number);
  return { year: y!, month: m! };
}

export function daysInMonth(month: string): number {
  const { year, month: m } = parseMonth(month);
  return new Date(year, m, 0).getDate();
}

/** Primer y último día del mes: { start: '2026-11-01', end: '2026-11-30' } */
export function monthBounds(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${month}-${pad(daysInMonth(month))}` };
}

export function addMonths(month: string, n: number): string {
  const { year, month: m } = parseMonth(month);
  const total = year * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** '2026-11' → 'noviembre 2026' */
export function monthLabel(month: string): string {
  const { year, month: m } = parseMonth(month);
  return new Date(year, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

/** '2026-11-04' → 'mié, 4 nov' */
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** '2027-12-01' → '1 dic 2027' */
export function dateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;
