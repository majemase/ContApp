import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { type Category, type Expense, currentMonth, dayLabel, formatEuros, monthSchema } from '@contapp/shared';
import { useCategories, useCreateExpense, useDeleteExpense, useExpenses, useUpdateExpense } from '../api';
import { ExpenseForm, QuickExpenseForm } from '../components/ExpenseForm';
import { CategoryIcon } from '../components/categories';
import { useConfirm, useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Modal, MonthPicker } from '../components/ui';

export function ExpensesPage() {
  const [params, setParams] = useSearchParams();
  const parsedMonth = monthSchema.safeParse(params.get('mes'));
  const month = parsedMonth.success ? parsedMonth.data : currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { mes: m });

  // Incluye archivadas para poder mostrar gastos antiguos; el formulario solo ofrece las activas.
  const categoriesQuery = useCategories(true);
  const expensesQuery = useExpenses(month);
  const [editing, setEditing] = useState<Expense | null>(null);

  const allCategories = categoriesQuery.data ?? [];
  const activeCategories = allCategories.filter((c) => !c.archived);
  const categoryById = new Map(allCategories.map((c) => [c.id, c]));
  const expenses = expensesQuery.data ?? [];

  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const impulsiveTotal = expenses.filter((e) => e.impulsive).reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Gastos</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      <Card>
        <QuickExpenseForm month={month} />
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-slate-500 dark:text-slate-400">Gastado este mes</p>
          <p className="text-2xl font-semibold tabular-nums">{formatEuros(total)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{expenses.length} {expenses.length === 1 ? 'gasto' : 'gastos'}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500 dark:text-slate-400">⚡ Impulsivos</p>
          <p className="text-2xl font-semibold text-amber-600 tabular-nums dark:text-amber-400">
            {formatEuros(impulsiveTotal)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {total > 0 ? `${Math.round((impulsiveTotal / total) * 100)} % del total` : '—'}
          </p>
        </Card>
      </div>

      {expensesQuery.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : expensesQuery.error ? (
        <ErrorText error={expensesQuery.error} />
      ) : expenses.length === 0 ? (
        <EmptyState>No hay gastos este mes.</EmptyState>
      ) : (
        <ExpenseList expenses={expenses} categoryById={categoryById} onSelect={setEditing} />
      )}

      <EditExpenseModal
        expense={editing}
        categories={activeCategories}
        categoryById={categoryById}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ExpenseList({
  expenses,
  categoryById,
  onSelect,
}: {
  expenses: Expense[];
  categoryById: Map<number, Category>;
  onSelect: (e: Expense) => void;
}) {
  // Los gastos ya vienen ordenados por fecha descendente.
  const byDay = new Map<string, Expense[]>();
  for (const e of expenses) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  return (
    <div className="space-y-4">
      {[...byDay].map(([date, items]) => (
        <section key={date}>
          <div className="mb-1 flex justify-between px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span className="first-letter:uppercase">{dayLabel(date)}</span>
            <span className="tabular-nums">{formatEuros(items.reduce((s, e) => s + e.amountCents, 0))}</span>
          </div>
          <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
            {items.map((e) => {
              const category = e.categoryId !== null ? categoryById.get(e.categoryId) : undefined;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <CategoryIcon category={category} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.note || category?.name || 'Sin categoría'}</p>
                    {e.note && category && (
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{category.name}</p>
                    )}
                  </div>
                  {e.recurringExpenseId !== null && <span title="Pago de un recurrente">🔁</span>}
                  {e.impulsive && <span title="Impulsivo">⚡</span>}
                  <span className="font-semibold tabular-nums">{formatEuros(e.amountCents)}</span>
                </button>
              );
            })}
          </Card>
        </section>
      ))}
    </div>
  );
}

function EditExpenseModal({
  expense,
  categories,
  categoryById,
  onClose,
}: {
  expense: Expense | null;
  categories: Category[];
  categoryById: Map<number, Category>;
  onClose: () => void;
}) {
  const update = useUpdateExpense();
  const remove = useDeleteExpense();
  const recreate = useCreateExpense();
  const confirm = useConfirm();
  const toast = useToast();

  // Si el gasto tiene una categoría archivada, se ofrece también para no perderla al guardar.
  const archived = expense?.categoryId != null ? categoryById.get(expense.categoryId) : undefined;
  const options = archived?.archived ? [...categories, archived] : categories;

  return (
    <Modal open={expense !== null} onClose={onClose} title="Editar gasto">
      {expense && (
        <div className="space-y-4">
          <ExpenseForm
            key={expense.id}
            initial={expense}
            categories={options}
            defaultDate={expense.date}
            submitLabel="Guardar"
            pending={update.isPending}
            error={update.error}
            onSubmit={async (input) => {
              await update.mutateAsync({ ...input, id: expense.id });
              onClose();
            }}
          />
          <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: '¿Borrar este gasto?',
                  message: `${expense.note || 'Gasto'} · ${formatEuros(expense.amountCents)}`,
                  confirmLabel: 'Borrar',
                  tone: 'danger',
                });
                if (!ok) return;
                await remove.mutateAsync(expense.id);
                onClose();
                const { id: _, ledgerId: __, createdAt: ___, ...data } = expense;
                toast({
                  message: 'Gasto borrado',
                  tone: 'info',
                  action: { label: 'Deshacer', onClick: () => recreate.mutate(data) },
                });
              }}
            >
              Borrar gasto
            </Button>
            <ErrorText error={remove.error} />
          </div>
        </div>
      )}
    </Modal>
  );
}
