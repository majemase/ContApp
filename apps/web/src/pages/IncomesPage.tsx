import { type FormEvent, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  INCOME_TYPES,
  INCOME_TYPE_LABELS,
  type Income,
  type IncomeInput,
  type IncomeType,
  centsToInput,
  currentMonth,
  dayLabel,
  formatEuros,
  monthBounds,
  monthSchema,
  parseEuros,
  todayISO,
} from '@contapp/shared';
import { useCreateIncome, useDeleteIncome, useIncomes, useSettings, useUpdateIncome } from '../api';
import { useConfirm, useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Input, Modal, MoneyInput, MonthPicker, cx } from '../components/ui';

const TYPE_ICONS: Record<IncomeType, string> = {
  salary: '💼',
  allowance: '🧾',
  bonus: '🎁',
  arrears: '⏪',
  other: '💶',
};

export function IncomesPage() {
  const [params, setParams] = useSearchParams();
  const parsedMonth = monthSchema.safeParse(params.get('mes'));
  const month = parsedMonth.success ? parsedMonth.data : currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { mes: m });

  const incomesQuery = useIncomes(month);
  const settings = useSettings().data;
  const create = useCreateIncome();
  const remove = useDeleteIncome();
  const toast = useToast();
  const [editing, setEditing] = useState<Income | null>(null);

  const incomes = incomesQuery.data ?? [];
  const total = incomes.reduce((s, i) => s + i.amountCents, 0);
  const reference = settings?.referenceIncomeCents ?? null;
  const defaultDate = month === currentMonth() ? todayISO() : monthBounds(month).end;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Ingresos</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      <Card>
        <IncomeForm
          key={defaultDate}
          defaultDate={defaultDate}
          submitLabel="Añadir ingreso"
          pending={create.isPending}
          error={create.error}
          resetOnSuccess
          onSubmit={async (input) => {
            const created = await create.mutateAsync(input);
            toast({
              message: `Ingreso añadido: ${formatEuros(created.amountCents)}`,
              tone: 'success',
              action: { label: 'Deshacer', onClick: () => remove.mutate(created.id) },
            });
          }}
        />
      </Card>

      <Card>
        <p className="text-xs text-slate-500 dark:text-slate-400">Cobrado este mes</p>
        <p className="text-2xl font-semibold tabular-nums">{formatEuros(total)}</p>
        {reference === null ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Configura tu{' '}
            <Link to="/ajustes" className="font-medium text-emerald-600 underline">
              ingreso de referencia
            </Link>{' '}
            para separar lo que es sueldo "seguro" de lo extra.
          </p>
        ) : (
          <ReferenceBar total={total} reference={reference} />
        )}
      </Card>

      {incomesQuery.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : incomesQuery.error ? (
        <ErrorText error={incomesQuery.error} />
      ) : incomes.length === 0 ? (
        <EmptyState>Aún no has apuntado ingresos este mes.</EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {incomes.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => setEditing(i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg dark:bg-emerald-900/40">
                {TYPE_ICONS[i.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.note || INCOME_TYPE_LABELS[i.type]}</p>
                <p className="truncate text-xs text-slate-500 first-letter:uppercase dark:text-slate-400">
                  {i.note ? `${INCOME_TYPE_LABELS[i.type]} · ` : ''}
                  {dayLabel(i.date)}
                </p>
              </div>
              <span className="font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                +{formatEuros(i.amountCents)}
              </span>
            </button>
          ))}
        </Card>
      )}

      <EditIncomeModal income={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Barra: parte "base" (hasta la referencia) y parte "extra". */
function ReferenceBar({ total, reference }: { total: number; reference: number }) {
  const extra = Math.max(0, total - reference);
  const scale = Math.max(total, reference);
  const basePct = (Math.min(total, reference) / scale) * 100;
  const extraPct = (extra / scale) * 100;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="bg-emerald-500" style={{ width: `${basePct}%` }} />
        <div className="bg-amber-400" style={{ width: `${extraPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />
          Referencia {formatEuros(reference)}
          {total < reference && ` · faltan ${formatEuros(reference - total)}`}
        </span>
        {extra > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            <span className="mr-1 inline-block size-2 rounded-full bg-amber-400" />
            Extra {formatEuros(extra)}
          </span>
        )}
      </div>
    </div>
  );
}

function EditIncomeModal({ income, onClose }: { income: Income | null; onClose: () => void }) {
  const update = useUpdateIncome();
  const remove = useDeleteIncome();
  const recreate = useCreateIncome();
  const confirm = useConfirm();
  const toast = useToast();

  return (
    <Modal open={income !== null} onClose={onClose} title="Editar ingreso">
      {income && (
        <div className="space-y-4">
          <IncomeForm
            key={income.id}
            initial={income}
            defaultDate={income.date}
            submitLabel="Guardar"
            pending={update.isPending}
            error={update.error}
            onSubmit={async (input) => {
              await update.mutateAsync({ ...input, id: income.id });
              onClose();
            }}
          />
          <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: '¿Borrar este ingreso?',
                  message: `${income.note || INCOME_TYPE_LABELS[income.type]} · ${formatEuros(income.amountCents)}`,
                  confirmLabel: 'Borrar',
                  tone: 'danger',
                });
                if (!ok) return;
                await remove.mutateAsync(income.id);
                onClose();
                const { date, amountCents, type, note } = income;
                toast({
                  message: 'Ingreso borrado',
                  tone: 'info',
                  action: { label: 'Deshacer', onClick: () => recreate.mutate({ date, amountCents, type, note }) },
                });
              }}
            >
              Borrar ingreso
            </Button>
            <ErrorText error={remove.error} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function IncomeForm({
  initial,
  defaultDate,
  submitLabel,
  pending,
  error,
  onSubmit,
  resetOnSuccess = false,
}: {
  initial?: Income;
  defaultDate: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: IncomeInput) => Promise<unknown>;
  resetOnSuccess?: boolean;
}) {
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : '');
  const [type, setType] = useState<IncomeType>(initial?.type ?? 'salary');
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.date ?? defaultDate);
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
      await onSubmit({ amountCents: cents, type, note, date });
    } catch {
      return;
    }
    if (resetOnSuccess) {
      // Se mantiene el tipo y la fecha: lo normal es meter varias líneas de la misma nómina seguidas.
      setAmount('');
      setNote('');
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
          />
        </div>
        <div className="w-40 shrink-0">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" required />
        </div>
      </div>
      {amountError && <p className="text-sm text-rose-600">{amountError}</p>}

      <div className="flex flex-wrap gap-1.5">
        {INCOME_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cx(
              'rounded-full px-3 py-1.5 text-sm transition',
              type === t
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {TYPE_ICONS[t]} {INCOME_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Nota (opcional): nómina octubre, atrasos convenio…"
        maxLength={200}
        aria-label="Nota"
      />

      <ErrorText error={error} />
      <Button type="submit" disabled={pending} className="w-full py-2.5">
        {pending ? 'Guardando…' : submitLabel}
      </Button>
    </form>
  );
}
