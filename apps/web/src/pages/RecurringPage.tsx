import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import {
  type Category,
  FREQUENCY_LABELS,
  MONTH_NAMES,
  PROVISION_FREQUENCIES,
  RECURRING_TYPES,
  RECURRING_TYPE_LABELS,
  type RecurringExpense,
  type RecurringType,
  addMonths,
  amountAt,
  centsToInput,
  commitmentSummary,
  currentMonth,
  dateLabel,
  formatEuros,
  monthBounds,
  monthLabel,
  nextDueMonth,
  parseEuros,
  todayISO,
} from '@contapp/shared';
import {
  useAddRecurringAmount,
  useCategories,
  useCreateRecurring,
  useDeleteRecurring,
  useDeleteRecurringAmount,
  useRecurring,
  useUpdateRecurring,
} from '../api';
import { CategoryIcon } from '../components/categories';
import { useConfirm, useToast } from '../components/feedback';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  cx,
} from '../components/ui';

const TYPE_HELP: Record<RecurringType, string> = {
  fixed: 'Se paga todos los meses: casa, cuota de autónomo, suscripciones…',
  provision: 'Se paga cada varios meses. Cada mes se aparta la parte proporcional: seguro del coche, IBI…',
  variable: 'Todos los meses, pero el importe cambia. Pones un presupuesto: gasolina, súper…',
};

const AMOUNT_LABEL: Record<RecurringType, string> = {
  fixed: 'Importe mensual',
  provision: 'Importe de cada pago',
  variable: 'Presupuesto mensual',
};

/** Importe que se muestra: el vigente hoy o, si aún no ha empezado, el primero. */
function displayAmount(r: RecurringExpense): number {
  return amountAt(r.amounts, todayISO()) ?? r.amounts[0]?.amountCents ?? 0;
}

export function RecurringPage() {
  const recurringQuery = useRecurring();
  const categoriesQuery = useCategories(true);
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);

  const recurring = recurringQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const month = currentMonth();
  const summary = commitmentSummary(recurring, month);

  return (
    <>
      <Link to="/ajustes" className="-mb-2 inline-block text-sm text-emerald-600 dark:text-emerald-400">
        ‹ Ajustes
      </Link>
      <PageHeader title="Recurrentes" action={<Button onClick={() => setEditing('new')}>+ Nuevo</Button>} />

      <Card>
        <p className="text-xs text-slate-500 dark:text-slate-400">Comprometido en {monthLabel(month)}</p>
        <p className="text-2xl font-semibold tabular-nums">{formatEuros(summary.total)}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          {RECURRING_TYPES.map((t) => (
            <div key={t} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              <dt className="text-slate-500 dark:text-slate-400">{RECURRING_TYPE_LABELS[t]}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{formatEuros(summary[t])}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {recurringQuery.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : recurringQuery.error ? (
        <ErrorText error={recurringQuery.error} />
      ) : recurring.length === 0 ? (
        <EmptyState>
          Aún no tienes gastos recurrentes. Empieza por lo que pagas siempre: casa, seguro del coche, gasolina…
        </EmptyState>
      ) : (
        RECURRING_TYPES.map((type) => {
          const items = recurring.filter((r) => r.type === type);
          if (items.length === 0) return null;
          return (
            <section key={type} className="space-y-1">
              <h2 className="px-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {RECURRING_TYPE_LABELS[type]}
              </h2>
              <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                {items.map((r) => (
                  <RecurringRow
                    key={r.id}
                    r={r}
                    category={r.categoryId !== null ? categoryById.get(r.categoryId) : undefined}
                    month={month}
                    onSelect={() => setEditing(r)}
                  />
                ))}
              </Card>
            </section>
          );
        })
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Nuevo gasto recurrente' : 'Editar gasto recurrente'}
      >
        {editing !== null && (
          <RecurringEditor
            // Tras guardar un cambio de importe el objeto se refresca desde la caché.
            recurring={editing === 'new' ? null : (recurring.find((r) => r.id === editing.id) ?? editing)}
            categories={categories.filter((c) => !c.archived || (editing !== 'new' && c.id === editing.categoryId))}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function RecurringRow({
  r,
  category,
  month,
  onSelect,
}: {
  r: RecurringExpense;
  category: Category | undefined;
  month: string;
  onSelect: () => void;
}) {
  const today = todayISO();
  const amount = displayAmount(r);
  const nextChange = r.amounts.find((a) => a.validFrom > today);
  const notStarted = r.startDate > today;
  const ended = r.endDate !== null && r.endDate < today;
  const nextDue = r.type === 'provision' ? nextDueMonth(r, month) : null;

  let detail: string;
  if (r.type === 'provision') {
    detail = `${formatEuros(amount)} ${FREQUENCY_LABELS[r.frequencyMonths]} · aparta ${formatEuros(Math.ceil(amount / r.frequencyMonths))}/mes`;
  } else if (r.type === 'variable') {
    detail = 'Presupuesto mensual';
  } else {
    detail = r.dueDay ? `Se cobra el día ${r.dueDay}` : 'Mensual';
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50',
        ended && 'opacity-50',
      )}
    >
      <CategoryIcon category={category} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.name}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{detail}</p>
        <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
          {notStarted && <Badge>Empieza el {dateLabel(r.startDate)}</Badge>}
          {ended && <Badge>Finalizado</Badge>}
          {nextDue && !ended && <Badge>Próximo pago: {monthLabel(nextDue)}</Badge>}
          {nextChange && !ended && (
            <Badge tone="amber">
              → {formatEuros(nextChange.amountCents)} desde {dateLabel(nextChange.validFrom)}
            </Badge>
          )}
        </div>
      </div>
      <span className="font-semibold tabular-nums">{formatEuros(amount)}</span>
    </button>
  );
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'amber' }) {
  return (
    <span
      className={cx(
        'rounded px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'amber'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      )}
    >
      {children}
    </span>
  );
}

// ---- Editor (alta / edición) ----

function RecurringEditor({
  recurring,
  categories,
  onClose,
}: {
  recurring: RecurringExpense | null;
  categories: Category[];
  onClose: () => void;
}) {
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();
  const confirm = useConfirm();
  const toast = useToast();

  const [name, setName] = useState(recurring?.name ?? '');
  const [type, setType] = useState<RecurringType>(recurring?.type ?? 'fixed');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(recurring?.categoryId ?? null);
  const [frequencyMonths, setFrequencyMonths] = useState(recurring?.frequencyMonths ?? 12);
  const [dueMonth, setDueMonth] = useState<number | null>(recurring?.dueMonth ?? null);
  const [dueDay, setDueDay] = useState(recurring?.dueDay ? String(recurring.dueDay) : '');
  const [startDate, setStartDate] = useState(recurring?.startDate ?? monthBounds(currentMonth()).start);
  const [endDate, setEndDate] = useState(recurring?.endDate ?? '');
  const [notes, setNotes] = useState(recurring?.notes ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = recurring ? update : create;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const isProvision = type === 'provision';
    const base = {
      name,
      type,
      categoryId,
      frequencyMonths: isProvision ? frequencyMonths : 1,
      dueMonth: isProvision ? dueMonth : null,
      dueDay: !isProvision && dueDay ? Number(dueDay) : null,
      startDate,
      endDate: endDate || null,
      notes,
    };
    try {
      if (recurring) {
        await update.mutateAsync({ ...base, id: recurring.id });
      } else {
        const amountCents = parseEuros(amount);
        if (amountCents === null || amountCents <= 0) {
          setLocalError('Importe no válido');
          return;
        }
        await create.mutateAsync({ ...base, amountCents });
      }
      onClose();
    } catch {
      // El error se muestra desde la mutación.
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seguro del coche" required autoFocus={!recurring} />
        </Field>

        <div className="space-y-1">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tipo</span>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {RECURRING_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cx(
                  'rounded-md px-2 py-1.5 text-sm font-medium',
                  type === t ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {RECURRING_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{TYPE_HELP[type]}</p>
        </div>

        <div className={cx('grid gap-3', !recurring && 'grid-cols-2')}>
          {!recurring && (
            <Field label={AMOUNT_LABEL[type]}>
              <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
          )}
          <Field label="Categoría">
            <Select
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {type === 'provision' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Se paga cada">
              <Select value={frequencyMonths} onChange={(e) => setFrequencyMonths(Number(e.target.value))}>
                {PROVISION_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f} meses ({FREQUENCY_LABELS[f]})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mes de pago" hint={frequencyMonths < 12 ? 'Uno de los meses en que se paga' : undefined}>
              <Select
                value={dueMonth ?? ''}
                onChange={(e) => setDueMonth(e.target.value ? Number(e.target.value) : null)}
                required
              >
                <option value="">Elige…</option>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          type === 'fixed' && (
            <Field label="Día de cobro (opcional)">
              <Input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                placeholder="Ej. 1"
              />
            </Field>
          )
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="Hasta (opcional)">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notas">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Field>

        {localError && <p className="text-sm text-rose-600">{localError}</p>}
        <ErrorText error={mutation.error} />
        <Button type="submit" disabled={mutation.isPending} className="w-full py-2.5">
          {mutation.isPending ? 'Guardando…' : recurring ? 'Guardar cambios' : 'Crear'}
        </Button>
      </form>

      {recurring && <AmountHistory recurring={recurring} />}

      {recurring && (
        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `¿Borrar «${recurring.name}»?`,
                message: 'Los gastos ya apuntados se conservan. Si solo has dejado de pagarlo, mejor pon una fecha en «Hasta».',
                confirmLabel: 'Borrar',
                tone: 'danger',
              });
              if (!ok) return;
              await remove.mutateAsync(recurring.id);
              onClose();
              toast({ message: `«${recurring.name}» borrado`, tone: 'info' });
            }}
          >
            Borrar gasto recurrente
          </Button>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Si simplemente has dejado de pagarlo, mejor pon una fecha en "Hasta" para conservar el histórico.
          </p>
          <ErrorText error={remove.error} />
        </div>
      )}
    </div>
  );
}

// ---- Historial de importes ----

function AmountHistory({ recurring }: { recurring: RecurringExpense }) {
  const add = useAddRecurringAmount();
  const remove = useDeleteRecurringAmount();
  const confirm = useConfirm();
  const [amount, setAmount] = useState('');
  const [validFrom, setValidFrom] = useState(monthBounds(addMonths(currentMonth(), 1)).start);
  const [localError, setLocalError] = useState<string | null>(null);
  const current = amountAt(recurring.amounts, todayISO());

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const amountCents = parseEuros(amount);
    if (amountCents === null || amountCents <= 0) {
      setLocalError('Importe no válido');
      return;
    }
    setLocalError(null);
    try {
      await add.mutateAsync({ id: recurring.id, amountCents, validFrom });
      setAmount('');
    } catch {
      // El error se muestra desde la mutación.
    }
  }

  return (
    <section className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 className="font-semibold">Importes</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Si el importe cambia (fin de la tarifa plana, subida del seguro…), añade el nuevo con la fecha desde la que
        aplica. Los meses anteriores conservan el importe antiguo.
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
        {recurring.amounts.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="flex-1">
              Desde {dateLabel(a.validFrom)}
              {a.amountCents === current && a.validFrom <= todayISO() && (
                <span className="ml-2 text-xs text-emerald-600">vigente</span>
              )}
            </span>
            <span className="font-semibold tabular-nums">{formatEuros(a.amountCents)}</span>
            {recurring.amounts.length > 1 && (
              <Button
                variant="danger"
                className="px-2 py-1"
                aria-label="Quitar importe"
                disabled={remove.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: '¿Quitar este importe?',
                    message: `${formatEuros(a.amountCents)} desde el ${dateLabel(a.validFrom)}`,
                    confirmLabel: 'Quitar',
                    tone: 'danger',
                  });
                  if (ok) remove.mutate({ id: recurring.id, amountId: a.id });
                }}
              >
                ✕
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Nuevo importe">
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={current !== null ? centsToInput(current) : '0,00'} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Desde">
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={add.isPending} className="py-2.5">
          Añadir
        </Button>
      </form>
      {localError && <p className="text-sm text-rose-600">{localError}</p>}
      <ErrorText error={add.error ?? remove.error} />
    </section>
  );
}
