import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AmountChangeInput,
  Category,
  CategoryInput,
  Expense,
  ExpenseInput,
  Income,
  IncomeInput,
  Ledger,
  RecurringCreateInput,
  RecurringExpense,
  RecurringUpdateInput,
  Settings,
} from '@contapp/shared';
import { useLedgerId } from './ledger';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  return data as T;
}

// ---- Ámbitos ----

export function useLedgers() {
  return useQuery({ queryKey: ['ledgers'], queryFn: () => request<Ledger[]>('/ledgers') });
}

// ---- Claves de caché ----

const keys = {
  categories: (ledgerId: number) => ['ledger', ledgerId, 'categories'] as const,
  recurring: (ledgerId: number) => ['ledger', ledgerId, 'recurring'] as const,
  expenses: (ledgerId: number) => ['ledger', ledgerId, 'expenses'] as const,
  incomes: (ledgerId: number) => ['ledger', ledgerId, 'incomes'] as const,
  settings: (ledgerId: number) => ['ledger', ledgerId, 'settings'] as const,
};

/** Mutación que invalida las consultas indicadas al terminar. */
function useLedgerMutation<TVars, TResult>(
  fn: (ledgerId: number, vars: TVars) => Promise<TResult>,
  invalidate: (ledgerId: number) => readonly unknown[][],
) {
  const ledgerId = useLedgerId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(ledgerId, vars),
    onSuccess: () => Promise.all(invalidate(ledgerId).map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

// ---- Categorías ----

export function useCategories(includeArchived = false) {
  const ledgerId = useLedgerId();
  return useQuery({
    queryKey: [...keys.categories(ledgerId), { includeArchived }],
    queryFn: () =>
      request<Category[]>(`/ledgers/${ledgerId}/categories${includeArchived ? '?includeArchived=true' : ''}`),
  });
}

export function useCreateCategory() {
  return useLedgerMutation(
    (l, input: CategoryInput) => request<Category>(`/ledgers/${l}/categories`, { method: 'POST', body: input }),
    (l) => [[...keys.categories(l)]],
  );
}

export function useUpdateCategory() {
  return useLedgerMutation(
    (l, { id, ...input }: CategoryInput & { id: number }) =>
      request<Category>(`/ledgers/${l}/categories/${id}`, { method: 'PUT', body: input }),
    (l) => [[...keys.categories(l)]],
  );
}

export function useDeleteCategory() {
  return useLedgerMutation(
    (l, id: number) => request<{ archived: boolean }>(`/ledgers/${l}/categories/${id}`, { method: 'DELETE' }),
    (l) => [[...keys.categories(l)]],
  );
}

export function useRestoreCategory() {
  return useLedgerMutation(
    (l, id: number) => request<Category>(`/ledgers/${l}/categories/${id}/restore`, { method: 'POST' }),
    (l) => [[...keys.categories(l)]],
  );
}

// ---- Gastos recurrentes ----

export function useRecurring() {
  const ledgerId = useLedgerId();
  return useQuery({
    queryKey: keys.recurring(ledgerId),
    queryFn: () => request<RecurringExpense[]>(`/ledgers/${ledgerId}/recurring`),
  });
}

export function useCreateRecurring() {
  return useLedgerMutation(
    (l, input: RecurringCreateInput) =>
      request<RecurringExpense>(`/ledgers/${l}/recurring`, { method: 'POST', body: input }),
    (l) => [[...keys.recurring(l)]],
  );
}

export function useUpdateRecurring() {
  return useLedgerMutation(
    (l, { id, ...input }: RecurringUpdateInput & { id: number }) =>
      request<RecurringExpense>(`/ledgers/${l}/recurring/${id}`, { method: 'PUT', body: input }),
    (l) => [[...keys.recurring(l)]],
  );
}

export function useDeleteRecurring() {
  return useLedgerMutation(
    (l, id: number) => request<void>(`/ledgers/${l}/recurring/${id}`, { method: 'DELETE' }),
    (l) => [[...keys.recurring(l)], [...keys.expenses(l)]],
  );
}

export function useAddRecurringAmount() {
  return useLedgerMutation(
    (l, { id, ...input }: AmountChangeInput & { id: number }) =>
      request<RecurringExpense>(`/ledgers/${l}/recurring/${id}/amounts`, { method: 'POST', body: input }),
    (l) => [[...keys.recurring(l)]],
  );
}

export function useDeleteRecurringAmount() {
  return useLedgerMutation(
    (l, { id, amountId }: { id: number; amountId: number }) =>
      request<RecurringExpense>(`/ledgers/${l}/recurring/${id}/amounts/${amountId}`, { method: 'DELETE' }),
    (l) => [[...keys.recurring(l)]],
  );
}

// ---- Gastos ----

export function useExpenses(month: string) {
  const ledgerId = useLedgerId();
  return useQuery({
    queryKey: [...keys.expenses(ledgerId), month],
    queryFn: () => request<Expense[]>(`/ledgers/${ledgerId}/expenses?month=${month}`),
  });
}

export function useCreateExpense() {
  return useLedgerMutation(
    (l, input: ExpenseInput) => request<Expense>(`/ledgers/${l}/expenses`, { method: 'POST', body: input }),
    (l) => [[...keys.expenses(l)]],
  );
}

export function useUpdateExpense() {
  return useLedgerMutation(
    (l, { id, ...input }: ExpenseInput & { id: number }) =>
      request<Expense>(`/ledgers/${l}/expenses/${id}`, { method: 'PUT', body: input }),
    (l) => [[...keys.expenses(l)]],
  );
}

export function useDeleteExpense() {
  return useLedgerMutation(
    (l, id: number) => request<void>(`/ledgers/${l}/expenses/${id}`, { method: 'DELETE' }),
    (l) => [[...keys.expenses(l)]],
  );
}

// ---- Ingresos ----

export function useIncomes(month: string) {
  const ledgerId = useLedgerId();
  return useQuery({
    queryKey: [...keys.incomes(ledgerId), month],
    queryFn: () => request<Income[]>(`/ledgers/${ledgerId}/incomes?month=${month}`),
  });
}

export function useCreateIncome() {
  return useLedgerMutation(
    (l, input: IncomeInput) => request<Income>(`/ledgers/${l}/incomes`, { method: 'POST', body: input }),
    (l) => [[...keys.incomes(l)]],
  );
}

export function useUpdateIncome() {
  return useLedgerMutation(
    (l, { id, ...input }: IncomeInput & { id: number }) =>
      request<Income>(`/ledgers/${l}/incomes/${id}`, { method: 'PUT', body: input }),
    (l) => [[...keys.incomes(l)]],
  );
}

export function useDeleteIncome() {
  return useLedgerMutation(
    (l, id: number) => request<void>(`/ledgers/${l}/incomes/${id}`, { method: 'DELETE' }),
    (l) => [[...keys.incomes(l)]],
  );
}

// ---- Ajustes ----

export function useSettings() {
  const ledgerId = useLedgerId();
  return useQuery({
    queryKey: keys.settings(ledgerId),
    queryFn: () => request<Settings>(`/ledgers/${ledgerId}/settings`),
  });
}

export function useUpdateSettings() {
  return useLedgerMutation(
    (l, input: Settings) => request<Settings>(`/ledgers/${l}/settings`, { method: 'PUT', body: input }),
    (l) => [[...keys.settings(l)]],
  );
}
