import { type MonthBudget, extraFreeParts } from './budget.ts';
import { type Bucket, type CloseMovement, type ExtraRule, type Settings, oneOffRulesOf } from './schemas.ts';

// ---- Medidor de reparto (necesidades / deseos / ahorro) ----

export interface MonthMeter {
  /** Base del medidor: lo cobrado (o la referencia si aún no hay ingresos apuntados). */
  income: number;
  /** Fijos (con sobrecostes) + provisiones apartadas + lo gastado en presupuestos variables. */
  needs: number;
  /** Gasto libre (caprichos, ocio, impulsivos…). */
  wants: number;
  /** Todo lo que no se gasta: acaba en huchas. */
  savings: number;
  pct: { needs: number; wants: number; savings: number } | null;
}

export function monthMeter(budget: MonthBudget): MonthMeter {
  const income = budget.income.estimated ? budget.income.base : budget.income.actual;
  const variableSpent = budget.variables.reduce((s, v) => s + v.spent, 0);
  const needs =
    budget.commitments.fixed + budget.spent.fixedOverrun + budget.commitments.provision + variableSpent;
  const wants = budget.spent.free;
  const savings = income - needs - wants;
  const pct =
    income > 0
      ? {
          needs: Math.round((needs / income) * 100),
          wants: Math.round((wants / income) * 100),
          savings: Math.round((savings / income) * 100),
        }
      : null;
  return { income, needs, wants, savings, pct };
}

// ---- Propuesta de cierre ----

export interface CloseProposalInput {
  budget: MonthBudget;
  settings: Settings;
  buckets: Bucket[];
  /** Hucha a la que va el sobrante (si sobra). */
  leftoverBucketId: number | null;
  /** Hucha desde la que se cubre el exceso (si falta). */
  coverBucketId: number | null;
}

export interface CloseProposal {
  movements: CloseMovement[];
  /** Problemas que impiden cerrar (falta elegir hucha, etc.). */
  problems: string[];
  /** Avisos que no impiden cerrar (pagos sin marcar…). */
  warnings: string[];
}

/**
 * Movimientos que genera el cierre de un mes. Todo lo cobrado acaba gastado o en una hucha:
 *   ahorro → su hucha · provisiones: apartado (+) y pagos (−) en la suya
 *   extra → según las reglas (la parte libre ya se sumó a lo disponible)
 *   sobrante → la hucha elegida · exceso → se cubre desde la hucha elegida
 */
export function proposeClose({ budget, settings, buckets, leftoverBucketId, coverBucketId }: CloseProposalInput): CloseProposal {
  const movements: CloseMovement[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const exists = (id: number | null): id is number => id !== null && buckets.some((b) => b.id === id && !b.archived);

  if (budget.income.estimated) {
    problems.push('No has apuntado ningún ingreso este mes.');
  }

  if (budget.savings > 0) {
    if (exists(settings.savingsBucketId)) {
      movements.push({ bucketId: settings.savingsBucketId, amountCents: budget.savings, kind: 'savings', note: 'Ahorro del mes' });
    } else {
      problems.push('Elige en Ajustes a qué hucha va el ahorro mensual.');
    }
  }

  for (const p of budget.provisions) {
    const bucket = buckets.find((b) => b.recurringExpenseId === p.id);
    if (!bucket) {
      problems.push(`La provisión «${p.name}» no tiene hucha.`);
      continue;
    }
    if (p.setAside > 0) {
      movements.push({ bucketId: bucket.id, amountCents: p.setAside, kind: 'provision', note: `Apartado: ${p.name}` });
    }
    if (p.paid > 0) {
      movements.push({ bucketId: bucket.id, amountCents: -p.paid, kind: 'provision_payment', note: `Pago: ${p.name}` });
    }
  }

  // El extra regular y el puntual (atrasos, devoluciones) se reparten cada uno con sus reglas.
  const { extra, extraOneOff } = budget.income;
  const free = extraFreeParts(settings, extra, extraOneOff);
  const parts = [
    { amount: extra - extraOneOff, free: free.regular, rules: settings.extraRules, label: 'Extra' },
    { amount: extraOneOff, free: free.oneOff, rules: oneOffRulesOf(settings), label: 'Puntual' },
  ];
  for (const part of parts) {
    if (part.amount <= 0) continue;
    const bucketRules = part.rules.filter((r): r is ExtraRule & { bucketId: number } => r.bucketId !== null);
    if (bucketRules.length === 0) {
      if (part.free === 0) problems.push('Tienes extra este mes: configura en Ajustes cómo repartirlo.');
      continue;
    }
    // Lo que va a huchas = parte − su parte libre. Se reparte proporcionalmente y el redondeo va a la primera.
    const toDistribute = part.amount - part.free;
    const rulesPct = bucketRules.reduce((s, r) => s + r.pct, 0);
    const amounts = bucketRules.map((r) => Math.floor((toDistribute * r.pct) / rulesPct));
    amounts[0]! += toDistribute - amounts.reduce((a, b) => a + b, 0);
    bucketRules.forEach((r, i) => {
      if (!exists(r.bucketId)) {
        problems.push('Una regla del reparto del extra apunta a una hucha que ya no existe.');
      } else if (amounts[i]! > 0) {
        movements.push({ bucketId: r.bucketId, amountCents: amounts[i]!, kind: 'extra', note: `${part.label} (${r.pct} %)` });
      }
    });
  }

  if (budget.leftover > 0) {
    if (exists(leftoverBucketId)) {
      movements.push({ bucketId: leftoverBucketId, amountCents: budget.leftover, kind: 'leftover', note: 'Sobrante del mes' });
    } else {
      problems.push('Elige a qué hucha va lo que ha sobrado.');
    }
  } else if (budget.leftover < 0) {
    if (exists(coverBucketId)) {
      movements.push({ bucketId: coverBucketId, amountCents: budget.leftover, kind: 'cover', note: 'Cubrir exceso del mes' });
    } else {
      problems.push('Elige desde qué hucha cubrir lo que te has pasado.');
    }
  }

  for (const d of budget.dues) {
    if (d.type === 'fixed' && !d.isPaid) {
      warnings.push(`«${d.name}» no está marcado como pagado. Si lo has pagado, márcalo antes de cerrar.`);
    }
  }

  return { movements, problems, warnings };
}
