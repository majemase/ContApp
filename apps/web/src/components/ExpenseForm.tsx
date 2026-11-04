import { type FormEvent, useRef, useState } from 'react';
import {
  type Category,
  type Expense,
  type ExpenseInput,
  centsToInput,
  currentMonth,
  formatEuros,
  monthBounds,
  parseEuros,
  todayISO,
} from '@contapp/shared';
import { useCategories, useCreateExpense, useDeleteExpense } from '../api';
import { CategoryChips } from './categories';
import { useToast } from './feedback';
import { Button, ErrorText, Input, MoneyInput, cx } from './ui';

/** Alta rápida de gasto con aviso y "Deshacer". `onAdded` se llama tras guardar (p. ej. para cerrar un modal). */
export function QuickExpenseForm({ month, onAdded }: { month: string; onAdded?: () => void }) {
  const categories = useCategories();
  const create = useCreateExpense();
  const remove = useDeleteExpense();
  const toast = useToast();
  const defaultDate = month === currentMonth() ? todayISO() : monthBounds(month).end;

  return (
    <ExpenseForm
      key={defaultDate}
      categories={categories.data ?? []}
      defaultDate={defaultDate}
      submitLabel="Añadir gasto"
      pending={create.isPending}
      error={create.error}
      resetOnSuccess
      onSubmit={async (input) => {
        const created = await create.mutateAsync(input);
        toast({
          message: `Gasto añadido: ${formatEuros(created.amountCents)}`,
          tone: 'success',
          action: { label: 'Deshacer', onClick: () => remove.mutate(created.id) },
        });
        onAdded?.();
      }}
    />
  );
}

export function ExpenseForm({
  initial,
  categories,
  defaultDate,
  submitLabel,
  pending,
  error,
  onSubmit,
  resetOnSuccess = false,
}: {
  initial?: Expense;
  categories: Category[];
  defaultDate: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: ExpenseInput) => Promise<unknown>;
  resetOnSuccess?: boolean;
}) {
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : '');
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [impulsive, setImpulsive] = useState(initial?.impulsive ?? false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (cents === null || cents <= 0) {
      setAmountError('Importe no válido');
      amountRef.current?.focus();
      return;
    }
    setAmountError(null);
    try {
      await onSubmit({
        amountCents: cents,
        categoryId,
        note,
        date,
        impulsive,
        recurringExpenseId: initial?.recurringExpenseId ?? null,
      });
    } catch {
      return; // El error ya se muestra a través de `error`.
    }
    if (resetOnSuccess) {
      setAmount('');
      setCategoryId(null);
      setNote('');
      setImpulsive(false);
      amountRef.current?.focus();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <MoneyInput
            ref={amountRef}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Importe"
            className="text-lg font-semibold"
            autoFocus={!initial}
          />
        </div>
        <div className="w-40 shrink-0">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" required />
        </div>
      </div>
      {amountError && <p className="text-sm text-rose-600">{amountError}</p>}

      <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />

      <div className="flex gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota (opcional): desayuno, gasolinera…"
          maxLength={200}
          aria-label="Nota"
        />
        <button
          type="button"
          onClick={() => setImpulsive(!impulsive)}
          aria-pressed={impulsive}
          title="Marcar como gasto impulsivo"
          className={cx(
            'shrink-0 rounded-lg px-3 text-sm font-medium ring-1 transition',
            impulsive
              ? 'bg-amber-100 text-amber-800 ring-amber-400 dark:bg-amber-900/40 dark:text-amber-200'
              : 'text-slate-500 ring-slate-300 dark:ring-slate-700',
          )}
        >
          ⚡ Impulsivo
        </button>
      </div>

      <ErrorText error={error} />
      <Button type="submit" disabled={pending} className="w-full py-2.5">
        {pending ? 'Guardando…' : submitLabel}
      </Button>
    </form>
  );
}
