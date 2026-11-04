import { type FormEvent, useState } from 'react';
import {
  BUCKET_TYPE_LABELS,
  type Bucket,
  type BucketType,
  MOVEMENT_KIND_LABELS,
  centsToInput,
  commitmentSummary,
  currentMonth,
  dateLabel,
  formatEuros,
  parseEuros,
  proposeClose,
  todayISO,
} from '@contapp/shared';
import {
  useBucketMovements,
  useBuckets,
  useCreateBucket,
  useCreateMovement,
  useDeleteBucket,
  useDeleteMovement,
  useRecurring,
  useRestoreBucket,
  useTransfer,
  useUpdateBucket,
} from '../api';
import { useConfirm, useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, MoneyInput, PageHeader, Select, cx } from '../components/ui';
import { useMonthBudget } from '../hooks';

type EditableType = Exclude<BucketType, 'provision'>;
const EDITABLE_TYPES: EditableType[] = ['savings', 'emergency', 'cushion', 'goal'];

const TEMPLATES: { name: string; icon: string; type: EditableType }[] = [
  { name: 'Regularización autónomo', icon: '💼', type: 'goal' },
  { name: 'Viaje', icon: '✈️', type: 'goal' },
  { name: 'Coche', icon: '🚗', type: 'goal' },
  { name: 'Regalos', icon: '🎁', type: 'goal' },
];

export function BucketsPage() {
  const bucketsQuery = useBuckets(true);
  const recurring = useRecurring();
  const month = currentMonth();
  const monthState = useMonthBudget(month);
  const [selected, setSelected] = useState<number | 'new' | null>(null);

  const all = bucketsQuery.data ?? [];
  const active = all.filter((b) => !b.archived);
  const archived = all.filter((b) => b.archived);
  const savingsBuckets = active.filter((b) => b.type !== 'provision');
  const provisionBuckets = active.filter((b) => b.type === 'provision');

  // Lo que entrará en cada hucha al cerrar este mes (sin contar el sobrante, que aún no se sabe).
  const pending = new Map<number, number>();
  if (monthState.status === 'ready') {
    const { movements } = proposeClose({
      budget: monthState.budget,
      settings: monthState.settings,
      buckets: active,
      leftoverBucketId: null,
      coverBucketId: null,
    });
    for (const m of movements) pending.set(m.bucketId, (pending.get(m.bucketId) ?? 0) + m.amountCents);
  }

  const totalSaved = savingsBuckets.reduce((s, b) => s + b.balanceCents, 0);
  const totalProvisions = provisionBuckets.reduce((s, b) => s + b.balanceCents, 0);
  const totalPending = savingsBuckets.reduce((s, b) => s + (pending.get(b.id) ?? 0), 0);
  // Fondo de emergencia recomendado: 3 meses de gastos comprometidos.
  const emergencySuggestion = recurring.data ? commitmentSummary(recurring.data, month).total * 3 : null;
  const selectedBucket = typeof selected === 'number' ? all.find((b) => b.id === selected) ?? null : null;

  return (
    <>
      <PageHeader title="Huchas" action={<Button onClick={() => setSelected('new')}>+ Nueva</Button>} />

      <Card>
        <p className="text-sm text-slate-500 dark:text-slate-400">Tienes ahorrado</p>
        <p className="text-3xl font-bold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-400">
          {formatEuros(totalSaved)}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500 dark:text-slate-400">
          {totalPending !== 0 && (
            <span>
              {totalPending > 0 ? '+' : ''}
              {formatEuros(totalPending)} al cerrar este mes
            </span>
          )}
          {totalProvisions !== 0 && <span>Además, {formatEuros(totalProvisions)} apartados en provisiones</span>}
        </div>
      </Card>

      {bucketsQuery.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : bucketsQuery.error ? (
        <ErrorText error={bucketsQuery.error} />
      ) : (
        <>
          <BucketList
            buckets={savingsBuckets}
            pending={pending}
            emergencySuggestion={emergencySuggestion}
            onSelect={setSelected}
          />
          {provisionBuckets.length > 0 && (
            <section className="space-y-1">
              <h2 className="px-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Provisiones</h2>
              <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
                Se llenan solas cada mes al cerrar y se vacían cuando pagas el recibo.
              </p>
              <BucketList buckets={provisionBuckets} pending={pending} emergencySuggestion={null} onSelect={setSelected} />
            </section>
          )}
          {archived.length > 0 && <ArchivedBuckets buckets={archived} />}
        </>
      )}

      <Modal open={selected === 'new'} onClose={() => setSelected(null)} title="Nueva hucha">
        {selected === 'new' && <BucketForm onDone={() => setSelected(null)} />}
      </Modal>
      <Modal open={selectedBucket !== null} onClose={() => setSelected(null)} title={selectedBucket?.name ?? ''}>
        {selectedBucket && (
          <BucketDetail
            bucket={selectedBucket}
            others={active.filter((b) => b.id !== selectedBucket.id)}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
    </>
  );
}

function BucketList({
  buckets,
  pending,
  emergencySuggestion,
  onSelect,
}: {
  buckets: Bucket[];
  pending: Map<number, number>;
  emergencySuggestion: number | null;
  onSelect: (id: number) => void;
}) {
  if (buckets.length === 0) return <EmptyState>No tienes huchas. Crea una con «+ Nueva».</EmptyState>;
  return (
    <div className="space-y-2">
      {buckets.map((b) => {
        const target = b.targetCents ?? (b.type === 'emergency' ? emergencySuggestion : null);
        const pct = target ? Math.min(100, (b.balanceCents / target) * 100) : null;
        const next = pending.get(b.id) ?? 0;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b.id)}
            className="block w-full text-left"
          >
            <Card className="transition hover:ring-emerald-300 dark:hover:ring-emerald-800">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xl dark:bg-emerald-950/50">
                  {b.icon || '🫙'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {next !== 0 ? `${next > 0 ? '+' : ''}${formatEuros(next)} al cerrar el mes` : BUCKET_TYPE_LABELS[b.type]}
                  </p>
                </div>
                <span className="text-lg font-semibold tabular-nums">{formatEuros(b.balanceCents)}</span>
              </div>
              {target !== null && pct !== null && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {Math.round(pct)} % de {formatEuros(target)}
                    {b.targetCents === null && ' (recomendado: 3 meses de gastos fijos)'}
                  </p>
                </div>
              )}
            </Card>
          </button>
        );
      })}
    </div>
  );
}

function ArchivedBuckets({ buckets }: { buckets: Bucket[] }) {
  const restore = useRestoreBucket();
  return (
    <section className="space-y-1">
      <h2 className="px-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Archivadas</h2>
      <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
        {buckets.map((b) => (
          <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
            <span className="text-lg">{b.icon || '🫙'}</span>
            <span className="flex-1">{b.name}</span>
            <Button variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate(b.id)}>
              Recuperar
            </Button>
          </div>
        ))}
      </Card>
    </section>
  );
}

// ---- Detalle de una hucha ----

type Action = 'in' | 'out' | 'transfer' | 'initial';

function BucketDetail({ bucket, others, onClose }: { bucket: Bucket; others: Bucket[]; onClose: () => void }) {
  const movements = useBucketMovements(bucket.id);
  const removeMovement = useDeleteMovement();
  const removeBucket = useDeleteBucket();
  const confirm = useConfirm();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState(false);

  async function handleDeleteBucket() {
    const ok = await confirm({
      title: `¿Borrar «${bucket.name}»?`,
      message: 'Si tiene movimientos se archivará para conservar el histórico.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const { archived } = await removeBucket.mutateAsync(bucket.id);
      onClose();
      toast({ message: archived ? `«${bucket.name}» archivada` : `«${bucket.name}» borrada`, tone: 'info' });
    } catch {
      // El error se muestra abajo.
    }
  }

  if (editing) return <BucketForm bucket={bucket} onDone={() => setEditing(false)} />;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-4xl">{bucket.icon || '🫙'}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{formatEuros(bucket.balanceCents)}</p>
        {bucket.targetCents !== null && (
          <p className="text-sm text-slate-500 dark:text-slate-400">de {formatEuros(bucket.targetCents)}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <ActionButton active={action === 'in'} onClick={() => setAction(action === 'in' ? null : 'in')}>
          ＋ Meter
        </ActionButton>
        <ActionButton active={action === 'out'} onClick={() => setAction(action === 'out' ? null : 'out')}>
          − Sacar
        </ActionButton>
        <ActionButton
          active={action === 'transfer'}
          onClick={() => setAction(action === 'transfer' ? null : 'transfer')}
        >
          ⇄ Traspasar
        </ActionButton>
      </div>

      {action && action !== 'transfer' && (
        <MovementForm key={action} bucket={bucket} action={action} onDone={() => setAction(null)} />
      )}
      {action === 'transfer' && <TransferForm bucket={bucket} others={others} onDone={() => setAction(null)} />}
      {action === null && (
        <button
          type="button"
          onClick={() => setAction('initial')}
          className="w-full text-center text-xs text-emerald-700 underline dark:text-emerald-400"
        >
          ¿Ya tenías dinero ahorrado? Apunta un saldo inicial
        </button>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">Movimientos</h3>
        {movements.isPending ? (
          <EmptyState>Cargando…</EmptyState>
        ) : !movements.data?.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Aún no hay movimientos.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
            {movements.data.map((m) => {
              const removable = m.kind === 'initial' || m.kind === 'manual' || m.kind === 'transfer';
              return (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{m.note || MOVEMENT_KIND_LABELS[m.kind]}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {dateLabel(m.date)}
                      {m.note && ` · ${MOVEMENT_KIND_LABELS[m.kind]}`}
                      {m.affectsBudget && ' · del dinero del mes'}
                    </p>
                  </div>
                  <span
                    className={cx(
                      'font-semibold tabular-nums',
                      m.amountCents > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {m.amountCents > 0 ? '+' : '−'}
                    {formatEuros(Math.abs(m.amountCents))}
                  </span>
                  {removable && (
                    <Button
                      variant="danger"
                      className="px-2 py-1"
                      aria-label="Deshacer movimiento"
                      disabled={removeMovement.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: '¿Deshacer este movimiento?',
                          message:
                            m.kind === 'transfer'
                              ? 'Se deshará el traspaso en las dos huchas.'
                              : `${m.note || MOVEMENT_KIND_LABELS[m.kind]} · ${formatEuros(Math.abs(m.amountCents))}`,
                          confirmLabel: 'Deshacer',
                          tone: 'danger',
                        });
                        if (ok) removeMovement.mutate(m.id);
                      }}
                    >
                      ✕
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ErrorText error={removeMovement.error} />
      </section>

      <div className="flex justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Editar
        </Button>
        {!(bucket.type === 'provision' && bucket.recurringExpenseId !== null) && (
          <Button variant="danger" onClick={handleDeleteBucket} disabled={removeBucket.isPending}>
            Borrar hucha
          </Button>
        )}
      </div>
      <ErrorText error={removeBucket.error} />
    </div>
  );
}

function ActionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-lg py-2 text-sm font-medium ring-1 transition',
        active
          ? 'bg-emerald-600 text-white ring-emerald-600'
          : 'text-slate-700 ring-slate-300 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  );
}

const ACTION_TEXT: Record<Exclude<Action, 'transfer'>, { label: string; budgetHint: string }> = {
  in: {
    label: 'Meter dinero',
    budgetHint: 'Sale de lo que te queda para gastar este mes.',
  },
  out: {
    label: 'Sacar dinero',
    budgetHint: 'Se suma a lo que puedes gastar este mes (p. ej. usar el colchón en verano).',
  },
  initial: {
    label: 'Saldo inicial',
    budgetHint: '',
  },
};

function MovementForm({ bucket, action, onDone }: { bucket: Bucket; action: Exclude<Action, 'transfer'>; onDone: () => void }) {
  const create = useCreateMovement();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [affectsBudget, setAffectsBudget] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (cents === null || cents <= 0) return setLocalError('Importe no válido');
    setLocalError(null);
    try {
      await create.mutateAsync({
        bucketId: bucket.id,
        amountCents: action === 'out' ? -cents : cents,
        date,
        kind: action === 'initial' ? 'initial' : 'manual',
        affectsBudget: action !== 'initial' && affectsBudget,
        note,
      });
      toast({
        message:
          action === 'out'
            ? `Has sacado ${formatEuros(cents)} de «${bucket.name}»`
            : `${formatEuros(cents)} en «${bucket.name}»`,
        tone: 'success',
      });
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  const text = ACTION_TEXT[action];
  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
      <p className="text-sm font-medium">{text.label}</p>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <MoneyInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Importe"
            autoFocus
            placeholder={action === 'out' ? centsToInput(Math.max(0, bucket.balanceCents)) : '0,00'}
          />
        </div>
        <div className="w-40 shrink-0">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" required />
        </div>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" />
      {action !== 'initial' ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={affectsBudget}
            onChange={(e) => setAffectsBudget(e.target.checked)}
            className="mt-0.5 size-4 accent-emerald-600"
          />
          <span>
            Del dinero de este mes
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {affectsBudget ? text.budgetHint : 'No cambia lo que puedes gastar este mes (dinero de fuera).'}
            </span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Dinero que ya tenías antes de usar la app. No afecta a lo que puedes gastar.
        </p>
      )}
      {localError && <p className="text-sm text-rose-600">{localError}</p>}
      <ErrorText error={create.error} />
      <Button type="submit" disabled={create.isPending} className="w-full">
        {create.isPending ? 'Guardando…' : 'Guardar'}
      </Button>
    </form>
  );
}

function TransferForm({ bucket, others, onDone }: { bucket: Bucket; others: Bucket[]; onDone: () => void }) {
  const transfer = useTransfer();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [otherId, setOtherId] = useState<number | null>(others[0]?.id ?? null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (cents === null || cents <= 0) return setLocalError('Importe no válido');
    if (otherId === null) return setLocalError('Elige la otra hucha');
    setLocalError(null);
    const [fromBucketId, toBucketId] = direction === 'out' ? [bucket.id, otherId] : [otherId, bucket.id];
    try {
      await transfer.mutateAsync({ fromBucketId, toBucketId, amountCents: cents, date: todayISO() });
      toast({ message: `Traspaso de ${formatEuros(cents)} hecho`, tone: 'success' });
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  if (others.length === 0) return <p className="text-sm text-slate-500">No tienes otras huchas.</p>;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/60 p-1 text-sm dark:bg-slate-900">
        {(['out', 'in'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={cx('rounded-md py-1.5 font-medium', direction === d ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}
          >
            {d === 'out' ? 'Enviar a…' : 'Traer de…'}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Select value={otherId ?? ''} onChange={(e) => setOtherId(Number(e.target.value))} aria-label="Otra hucha">
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.icon} {b.name} ({formatEuros(b.balanceCents)})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32 shrink-0">
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Importe" autoFocus />
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">Mueve dinero entre huchas. No afecta a lo que puedes gastar.</p>
      {localError && <p className="text-sm text-rose-600">{localError}</p>}
      <ErrorText error={transfer.error} />
      <Button type="submit" disabled={transfer.isPending} className="w-full">
        {transfer.isPending ? 'Guardando…' : 'Traspasar'}
      </Button>
    </form>
  );
}

// ---- Alta / edición ----

function BucketForm({ bucket, onDone }: { bucket?: Bucket; onDone: () => void }) {
  const create = useCreateBucket();
  const update = useUpdateBucket();
  const toast = useToast();
  const isProvision = bucket?.type === 'provision';
  const [name, setName] = useState(bucket?.name ?? '');
  const [icon, setIcon] = useState(bucket?.icon ?? '');
  const [type, setType] = useState<EditableType>(bucket && bucket.type !== 'provision' ? bucket.type : 'goal');
  const [target, setTarget] = useState(bucket?.targetCents ? centsToInput(bucket.targetCents) : '');
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = bucket ? update : create;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const targetCents = target.trim() === '' ? null : parseEuros(target);
    if (target.trim() !== '' && (targetCents === null || targetCents <= 0)) return setLocalError('Meta no válida');
    setLocalError(null);
    const input = { name, icon: icon.trim(), type, targetCents };
    try {
      if (bucket) await update.mutateAsync({ ...input, id: bucket.id });
      else await create.mutateAsync(input);
      toast({ message: bucket ? 'Hucha guardada' : `Hucha «${name}» creada`, tone: 'success' });
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!bucket && (
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                setName(t.name);
                setIcon(t.icon);
                setType(t.type);
              }}
              className="rounded-full bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {t.icon} {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-3">
        <div className="w-16 shrink-0">
          <Field label="Icono">
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} placeholder="🫙" className="text-center text-xl" />
          </Field>
        </div>
        <div className="min-w-0 flex-1">
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} disabled={isProvision} />
          </Field>
        </div>
      </div>
      {!isProvision && (
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as EditableType)}>
            {EDITABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {BUCKET_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Meta (opcional)" hint="Cuánto quieres llegar a tener. Verás el progreso en la hucha.">
        <MoneyInput value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      {localError && <p className="text-sm text-rose-600">{localError}</p>}
      <ErrorText error={mutation.error} />
      <div className="flex justify-end gap-2">
        {bucket && (
          <Button variant="secondary" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : bucket ? 'Guardar' : 'Crear hucha'}
        </Button>
      </div>
    </form>
  );
}
