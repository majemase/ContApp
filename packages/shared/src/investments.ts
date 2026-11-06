import { z } from 'zod';
import { toMonth } from './dates.ts';
import { centsSchema, isoDateSchema } from './schemas.ts';

// Inversiones. Todo el dinero en céntimos; las participaciones, en enteros escalados (UNITS_SCALE).
//
//   aportado neto     = aportado − retirado
//   valor             = última valoración + aportado − retirado desde esa fecha (estimado entre valoraciones)
//   ganancia/pérdida  = valor + retirado + dividendos cobrados − aportado − comisiones pagadas aparte

// ---- Catálogos ----

export const ASSET_TYPES = ['index_fund', 'fund', 'etf', 'stock', 'crypto', 'pension', 'deposit', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  index_fund: 'Fondo indexado',
  fund: 'Fondo de inversión',
  etf: 'ETF',
  stock: 'Acción',
  crypto: 'Cripto',
  pension: 'Plan de pensiones',
  deposit: 'Depósito / cuenta',
  other: 'Otro',
};

export const ASSET_CLASSES = ['equity', 'fixed_income', 'money_market', 'crypto', 'other'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: 'Renta variable',
  fixed_income: 'Renta fija',
  money_market: 'Monetario / liquidez',
  crypto: 'Cripto',
  other: 'Otros',
};

export const ASSET_REGIONS = ['global', 'us', 'europe', 'spain', 'emerging', 'other'] as const;
export type AssetRegion = (typeof ASSET_REGIONS)[number];
export const ASSET_REGION_LABELS: Record<AssetRegion, string> = {
  global: 'Global',
  us: 'EE. UU.',
  europe: 'Europa',
  spain: 'España',
  emerging: 'Emergentes',
  other: 'Otra',
};

/**
 * - contribution: aportación (compra). Sale dinero hacia la inversión.
 * - withdrawal: retirada (venta). Vuelve dinero desde la inversión.
 * - dividend: dividendo cobrado. Si se reinvierte, ya está en el valor y solo es informativo.
 * - fee: comisión. Si se paga aparte (del mes o de una hucha) resta de la ganancia;
 *   si la descuenta el bróker de la inversión, ya está en el valor y solo es informativa.
 */
export const OPERATION_KINDS = ['contribution', 'withdrawal', 'dividend', 'fee'] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];
export const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  contribution: 'Aportación',
  withdrawal: 'Retirada',
  dividend: 'Dividendo',
  fee: 'Comisión',
};

/**
 * De dónde sale el dinero (aportación, comisión) o adónde va (retirada, dividendo):
 * - month: el dinero del mes (afecta a lo que puedes gastar)
 * - bucket: una hucha (crea su movimiento en la hucha)
 * - none: fuera de la app (lo que ya tenías invertido, un dividendo reinvertido…). No afecta a nada.
 */
export const OPERATION_SOURCES = ['month', 'bucket', 'none'] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

/** Dinero que entra en la inversión (sale del mes o de la hucha). */
export const isOutflow = (kind: OperationKind) => kind === 'contribution' || kind === 'fee';

// ---- Participaciones ----

/** Las participaciones se guardan como entero × 10⁸ (8 decimales, suficiente para cripto). */
export const UNITS_SCALE = 100_000_000;
const UNIT_DECIMALS = 8;

/** "12,5" → 1250000000. Acepta coma o punto decimal y hasta 8 decimales. Null si no es válido o es 0. */
export function parseUnits(input: string): number | null {
  const s = input.replace(/\s/g, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(s);
  if (!match) return null;
  const [, intPart, decPart = ''] = match;
  const value = Number(intPart) * UNITS_SCALE + Number(decPart.padEnd(UNIT_DECIMALS, '0'));
  if (!Number.isSafeInteger(value) || value === 0) return null;
  return value;
}

/** 1250000000 → "12,5" (sin ceros sobrantes). */
export function formatUnits(scaled: number): string {
  const sign = scaled < 0 ? '-' : '';
  const abs = Math.abs(scaled);
  const int = Math.floor(abs / UNITS_SCALE);
  const dec = String(abs % UNITS_SCALE).padStart(UNIT_DECIMALS, '0').replace(/0+$/, '');
  return `${sign}${int.toLocaleString('es-ES')}${dec ? `,${dec}` : ''}`;
}

/** Valor de unas participaciones a un precio por participación (en céntimos), redondeado al céntimo. */
export function unitsValue(units: number, priceCents: number): number {
  return Math.round((units / UNITS_SCALE) * priceCents);
}

// ---- Validación (API y formularios) ----

export const investmentAccountInputSchema = z.object({
  name: z.string().trim().min(1, 'Pon un nombre').max(40),
});
export type InvestmentAccountInput = z.input<typeof investmentAccountInputSchema>;

export const investmentAssetInputSchema = z.object({
  accountId: z.int().positive('Elige una cuenta'),
  name: z.string().trim().min(1, 'Pon un nombre').max(60),
  ticker: z.string().trim().max(20).default(''),
  type: z.enum(ASSET_TYPES),
  assetClass: z.enum(ASSET_CLASSES),
  region: z.enum(ASSET_REGIONS),
});
export type InvestmentAssetInput = z.input<typeof investmentAssetInputSchema>;

export const investmentOperationInputSchema = z
  .object({
    assetId: z.int().positive(),
    date: isoDateSchema,
    kind: z.enum(OPERATION_KINDS),
    amountCents: centsSchema,
    /** Participaciones compradas o vendidas (× UNITS_SCALE). Opcional. */
    units: z.int().positive().nullable().default(null),
    source: z.enum(OPERATION_SOURCES),
    bucketId: z.int().positive().nullable().default(null),
    note: z.string().trim().max(200).default(''),
  })
  .superRefine((op, ctx) => {
    if (op.source === 'bucket' && op.bucketId === null) {
      ctx.addIssue({ code: 'custom', path: ['bucketId'], message: 'Elige la hucha' });
    }
    if (op.source !== 'bucket' && op.bucketId !== null) {
      ctx.addIssue({ code: 'custom', path: ['bucketId'], message: 'La hucha solo se indica si el dinero sale o va a una hucha' });
    }
    if (op.units !== null && (op.kind === 'dividend' || op.kind === 'fee')) {
      ctx.addIssue({ code: 'custom', path: ['units'], message: 'Las participaciones solo van en aportaciones y retiradas' });
    }
  });
export type InvestmentOperationInput = z.input<typeof investmentOperationInputSchema>;

export const investmentValuationInputSchema = z.object({
  assetId: z.int().positive(),
  date: isoDateSchema,
  /** Valor total del activo en esa fecha. */
  valueCents: z.int().min(0, 'El valor no puede ser negativo'),
});
export type InvestmentValuationInput = z.input<typeof investmentValuationInputSchema>;

// ---- Tipos de la API ----

export interface InvestmentAccount {
  id: number;
  name: string;
  archived: boolean;
}

export interface InvestmentAsset {
  id: number;
  accountId: number;
  name: string;
  ticker: string;
  type: AssetType;
  assetClass: AssetClass;
  region: AssetRegion;
  archived: boolean;
}

export interface InvestmentOperation {
  id: number;
  assetId: number;
  date: string;
  kind: OperationKind;
  amountCents: number;
  units: number | null;
  source: OperationSource;
  bucketId: number | null;
  /** Aportación periódica que la generó (recurrente de tipo inversión). */
  recurringExpenseId: number | null;
  note: string;
  createdAt: string;
}

export interface InvestmentValuation {
  id: number;
  assetId: number;
  date: string;
  valueCents: number;
}

/** Todo lo de inversiones de un ámbito (la página y el presupuesto lo calculan en el cliente). */
export interface InvestmentsData {
  accounts: InvestmentAccount[];
  assets: InvestmentAsset[];
  operations: InvestmentOperation[];
  valuations: InvestmentValuation[];
}

// ---- Cálculos ----

export interface PositionSummary {
  contributed: number;
  withdrawn: number;
  /** Dividendos cobrados fuera de la inversión (al mes, a una hucha o fuera). */
  dividendsPaidOut: number;
  /** Dividendos reinvertidos: ya están en el valor; solo informativo. */
  dividendsReinvested: number;
  /** Comisiones pagadas aparte (restan de la ganancia). */
  feesPaid: number;
  /** Comisiones descontadas dentro de la inversión: ya están en el valor; solo informativo. */
  feesInside: number;
  netContributed: number;
  value: number;
  /** Fecha de la última valoración usada. Null si nunca se ha valorado. */
  valuedAt: string | null;
  /** true si el valor no sale solo de una valoración (no hay o hubo operaciones después). */
  valueIsEstimate: boolean;
  gain: number;
  /** Ganancia sobre lo aportado, en %. Null si no se ha aportado nada. */
  gainPct: number | null;
  /** Participaciones en cartera, si se han apuntado en todas las compras y ventas. */
  units: number | null;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Situación de una posición (un activo, o varios sumados) a una fecha.
 * La valoración de un día incluye las operaciones de ese mismo día.
 */
export function positionSummary(
  operations: Pick<InvestmentOperation, 'date' | 'kind' | 'amountCents' | 'units' | 'source'>[],
  valuations: Pick<InvestmentValuation, 'date' | 'valueCents'>[],
  asOf?: string,
): PositionSummary {
  const ops = asOf ? operations.filter((o) => o.date <= asOf) : operations;
  const vals = asOf ? valuations.filter((v) => v.date <= asOf) : valuations;
  const amountOf = (kind: OperationKind, filter: (o: (typeof ops)[number]) => boolean = () => true) =>
    sum(ops.filter((o) => o.kind === kind && filter(o)).map((o) => o.amountCents));

  const contributed = amountOf('contribution');
  const withdrawn = amountOf('withdrawal');
  const dividendsPaidOut = amountOf('dividend', (o) => o.source !== 'none');
  const dividendsReinvested = amountOf('dividend', (o) => o.source === 'none');
  const feesPaid = amountOf('fee', (o) => o.source !== 'none');
  const feesInside = amountOf('fee', (o) => o.source === 'none');
  const netContributed = contributed - withdrawn;

  const last = vals.reduce<(typeof vals)[number] | null>((best, v) => (!best || v.date > best.date ? v : best), null);
  let value: number;
  let valueIsEstimate: boolean;
  if (last) {
    const after = ops.filter((o) => o.date > last.date);
    const flow = sum(after.filter((o) => o.kind === 'contribution').map((o) => o.amountCents)) -
      sum(after.filter((o) => o.kind === 'withdrawal').map((o) => o.amountCents));
    value = Math.max(0, last.valueCents + flow);
    valueIsEstimate = flow !== 0;
  } else {
    value = Math.max(0, netContributed);
    valueIsEstimate = ops.length > 0;
  }

  const gain = value + withdrawn + dividendsPaidOut - contributed - feesPaid;
  const trades = ops.filter((o) => o.kind === 'contribution' || o.kind === 'withdrawal');
  const units =
    trades.length > 0 && trades.every((o) => o.units !== null)
      ? sum(trades.map((o) => (o.kind === 'contribution' ? o.units! : -o.units!)))
      : null;

  return {
    contributed,
    withdrawn,
    dividendsPaidOut,
    dividendsReinvested,
    feesPaid,
    feesInside,
    netContributed,
    value,
    valuedAt: last?.date ?? null,
    valueIsEstimate,
    gain,
    gainPct: contributed > 0 ? Math.round((gain / contributed) * 1000) / 10 : null,
    units,
  };
}

export interface AssetPosition extends PositionSummary {
  asset: InvestmentAsset;
}

export interface Portfolio {
  /** Activos con dinero o con historial, ordenados por valor. */
  positions: AssetPosition[];
  total: PositionSummary;
}

/** Cartera completa: una posición por activo y el total. */
export function portfolio(data: InvestmentsData, asOf?: string): Portfolio {
  const positions = data.assets
    .map((asset) => ({
      asset,
      ...positionSummary(
        data.operations.filter((o) => o.assetId === asset.id),
        data.valuations.filter((v) => v.assetId === asset.id),
        asOf,
      ),
    }))
    .sort((a, b) => b.value - a.value || a.asset.name.localeCompare(b.asset.name));

  // El total suma posiciones (no se puede recalcular de golpe: cada activo tiene su última valoración).
  const total: PositionSummary = {
    contributed: sum(positions.map((p) => p.contributed)),
    withdrawn: sum(positions.map((p) => p.withdrawn)),
    dividendsPaidOut: sum(positions.map((p) => p.dividendsPaidOut)),
    dividendsReinvested: sum(positions.map((p) => p.dividendsReinvested)),
    feesPaid: sum(positions.map((p) => p.feesPaid)),
    feesInside: sum(positions.map((p) => p.feesInside)),
    netContributed: sum(positions.map((p) => p.netContributed)),
    value: sum(positions.map((p) => p.value)),
    valuedAt: positions.reduce<string | null>((d, p) => (p.valuedAt && (!d || p.valuedAt > d) ? p.valuedAt : d), null),
    valueIsEstimate: positions.some((p) => p.valueIsEstimate),
    gain: sum(positions.map((p) => p.gain)),
    gainPct: null,
    units: null,
  };
  total.gainPct = total.contributed > 0 ? Math.round((total.gain / total.contributed) * 1000) / 10 : null;
  return { positions, total };
}

export interface AllocationSlice<K extends string | number> {
  key: K;
  value: number;
  /** % del total, con un decimal. */
  pct: number;
}

/** Reparto del valor de la cartera según una clave (clase, región, cuenta…). Solo cuenta lo que vale > 0. */
export function allocation<K extends string | number>(
  positions: AssetPosition[],
  keyOf: (p: AssetPosition) => K,
): AllocationSlice<K>[] {
  const totals = new Map<K, number>();
  for (const p of positions) {
    if (p.value <= 0) continue;
    totals.set(keyOf(p), (totals.get(keyOf(p)) ?? 0) + p.value);
  }
  const total = sum([...totals.values()]);
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value, pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Lo que las inversiones mueven del dinero de un mes, en el mismo signo que los movimientos de huchas:
 * positivo = sale del mes hacia la inversión; negativo = vuelve al mes.
 * Las aportaciones de una aportación periódica no cuentan: ya están en lo comprometido.
 */
export function investmentMonthFlows(
  operations: Pick<InvestmentOperation, 'date' | 'kind' | 'amountCents' | 'source' | 'recurringExpenseId'>[],
  month: string,
): { amountCents: number }[] {
  return operations
    .filter((o) => o.source === 'month' && o.recurringExpenseId === null && toMonth(o.date) === month)
    .map((o) => ({ amountCents: isOutflow(o.kind) ? o.amountCents : -o.amountCents }));
}
