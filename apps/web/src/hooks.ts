import { type MonthBudget, type Settings, computeMonthBudget, investmentMonthFlows, todayISO } from '@contapp/shared';
import { useExpenses, useIncomes, useInvestments, useMonthMovements, useRecurring, useSettings } from './api';

export type MonthBudgetState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; budget: MonthBudget; settings: Settings };

/** Presupuesto de un mes calculado con todos sus datos (ingresos, gastos, recurrentes, huchas, inversiones). */
export function useMonthBudget(month: string): MonthBudgetState {
  const settings = useSettings();
  const incomes = useIncomes(month);
  const expenses = useExpenses(month);
  const recurring = useRecurring();
  const movements = useMonthMovements(month);
  const investments = useInvestments();

  const error = [settings, incomes, expenses, recurring, movements, investments].find((q) => q.error)?.error;
  if (error) return { status: 'error', error };
  if (!settings.data || !incomes.data || !expenses.data || !recurring.data || !movements.data || !investments.data) {
    return { status: 'loading' };
  }

  return {
    status: 'ready',
    settings: settings.data,
    budget: computeMonthBudget({
      month,
      today: todayISO(),
      settings: settings.data,
      incomes: incomes.data,
      expenses: expenses.data,
      recurring: recurring.data,
      budgetMovements: movements.data.filter((m) => m.affectsBudget),
      investmentFlows: investmentMonthFlows(investments.data.operations, month),
    }),
  };
}
