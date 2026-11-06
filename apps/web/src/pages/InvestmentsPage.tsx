import { type FormEvent, useState } from 'react';
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_REGIONS,
  ASSET_REGION_LABELS,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  type AssetClass,
  type AssetPosition,
  type AssetType,
  type Bucket,
  type InvestmentAccount,
  type InvestmentAsset,
  type InvestmentsData,
  OPERATION_KIND_LABELS,
  type OperationKind,
  type OperationSource,
  type PositionSummary,
  allocation,
  dateLabel,
  formatEuros,
  formatUnits,
  parseEuros,
  parseUnits,
  portfolio,
  todayISO,
  unitsValue,
} from '@contapp/shared';
import {
  useBuckets,
  useCreateInvestmentAccount,
  useCreateInvestmentAsset,
  useCreateInvestmentOperation,
  useDeleteInvestmentAccount,
  useDeleteInvestmentAsset,
  useDeleteInvestmentOperation,
  useDeleteInvestmentValuation,
  useInvestments,
  useRestoreInvestmentAccount,
  useRestoreInvestmentAsset,
  useSaveInvestmentValuation,
  useUpdateInvestmentAccount,
  useUpdateInvestmentAsset,
} from '../api';
import { AllocationChart, SERIES_COUNT, type Slice, formatPct } from '../components/Allocation';
import { useConfirm, useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, MoneyInput, PageHeader, Select, cx } from '../components/ui';

type Selected = { kind: 'asset'; id: number } | { kind: 'account'; id: number } | { kind: 'new' } | null;

export function InvestmentsPage() {
  const query = useInvestments();
  const buckets = useBuckets();
  const [selected, setSelected] = useState<Selected>(null);

  if (query.isPending) return <EmptyState>Cargando…</EmptyState>;
  if (query.error) return <ErrorText error={query.error} />;

  const data = query.data;
  const { positions, total } = portfolio(data);
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const activePositions = positions.filter((p) => !p.asset.archived);
  const archivedAssets = data.assets.filter((a) => a.archived);
  const archivedAccounts = data.accounts.filter((a) => a.archived);
  const usableBuckets = (buckets.data ?? []).filter((b) => b.type !== 'provision');

  const selectedPosition =
    selected?.kind === 'asset' ? positions.find((p) => p.asset.id === selected.id) ?? null : null;
  const selectedAccount =
    selected?.kind === 'account' ? data.accounts.find((a) => a.id === selected.id) ?? null : null;
  const close = () => setSelected(null);

  return (
    <>
      <PageHeader title="Inversiones" action={<Button onClick={() => setSelected({ kind: 'new' })}>+ Activo</Button>} />

      {data.assets.length === 0 ? (
        <Card className="space-y-3 text-center">
          <p className="text-4xl">📈</p>
          <p className="font-medium">Apunta lo que tienes invertido</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Crea un activo (un fondo, un ETF…) dentro de su cuenta o bróker. Si ya tenías dinero invertido, apúntalo
            como aportación «Ya lo tenía invertido».
          </p>
          <Button onClick={() => setSelected({ kind: 'new' })}>Añadir mi primera inversión</Button>
        </Card>
      ) : (
        <>
          <PortfolioSummary total={total} />
          <AllocationCard data={data} positions={positions} />
          {activeAccounts.map((account) => (
            <AccountSection
              key={account.id}
              account={account}
              positions={activePositions.filter((p) => p.asset.accountId === account.id)}
              onSelectAsset={(id) => setSelected({ kind: 'asset', id })}
              onEditAccount={() => setSelected({ kind: 'account', id: account.id })}
            />
          ))}
          {(archivedAssets.length > 0 || archivedAccounts.length > 0) && (
            <Archived assets={archivedAssets} accounts={archivedAccounts} />
          )}
        </>
      )}

      <Modal open={selected?.kind === 'new'} onClose={close} title="Nuevo activo">
        {selected?.kind === 'new' && <AssetForm accounts={activeAccounts} onDone={close} />}
      </Modal>
      <Modal open={selectedPosition !== null} onClose={close} title={selectedPosition?.asset.name ?? ''}>
        {selectedPosition && (
          <AssetDetail
            position={selectedPosition}
            data={data}
            accounts={activeAccounts}
            buckets={usableBuckets}
            onClose={close}
          />
        )}
      </Modal>
      <Modal open={selectedAccount !== null} onClose={close} title="Cuenta">
        {selectedAccount && <AccountForm account={selectedAccount} onDone={close} />}
      </Modal>
    </>
  );
}

// ---- Resumen ----

function PortfolioSummary({ total }: { total: PositionSummary }) {
  return (
    <Card>
      <p className="text-sm text-slate-500 dark:text-slate-400">Valor de tu cartera</p>
      <p className="text-3xl font-bold tracking-tight tabular-nums">{formatEuros(total.value)}</p>
      <Gain summary={total} className="text-sm" />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Stat label="Aportado" value={total.contributed} />
        <Stat label="Retirado" value={total.withdrawn} />
        <Stat label="Invertido ahora" value={total.netContributed} />
      </dl>
      {total.valueIsEstimate && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Valor estimado: hay activos sin valorar o con aportaciones después de su última valoración.
        </p>
      )}
    </Card>
  );
}

function Gain({ summary, className }: { summary: PositionSummary; className?: string }) {
  const { gain, gainPct } = summary;
  const tone =
    gain > 0 ? 'text-emerald-700 dark:text-emerald-400' : gain < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500';
  return (
    <p className={cx('font-medium tabular-nums', tone, className)}>
      {gain > 0 ? '▲ +' : gain < 0 ? '▼ −' : ''}
      {formatEuros(Math.abs(gain))}
      {gainPct !== null && ` (${gain > 0 ? '+' : ''}${formatPct(gainPct)})`}
      <span className="font-normal text-slate-500 dark:text-slate-400"> {gain >= 0 ? 'de ganancia' : 'de pérdida'}</span>
    </p>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium tabular-nums">{formatEuros(value)}</dd>
    </div>
  );
}

// ---- Reparto ----

type Dimension = 'class' | 'region' | 'account' | 'asset';
const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'class', label: 'Tipo' },
  { key: 'region', label: 'Región' },
  { key: 'account', label: 'Cuenta' },
  { key: 'asset', label: 'Activo' },
];

/** Posición fija de cada entidad en su catálogo (o por id), para que conserve su color. */
function colorIndex(order: (string | number)[], key: string | number): number | null {
  const i = order.indexOf(key);
  return i >= 0 && i < SERIES_COUNT - 1 ? i : null;
}

function AllocationCard({ data, positions }: { data: InvestmentsData; positions: AssetPosition[] }) {
  const [dimension, setDimension] = useState<Dimension>('class');

  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const accountOrder = data.accounts.map((a) => a.id).sort((a, b) => a - b);
  const assetOrder = data.assets.map((a) => a.id).sort((a, b) => a - b);

  let slices: Slice[];
  if (dimension === 'class') {
    slices = allocation(positions, (p) => p.asset.assetClass).map((s) => ({
      ...s,
      label: ASSET_CLASS_LABELS[s.key],
      colorIndex: colorIndex([...ASSET_CLASSES], s.key),
    }));
  } else if (dimension === 'region') {
    slices = allocation(positions, (p) => p.asset.region).map((s) => ({
      ...s,
      label: ASSET_REGION_LABELS[s.key],
      colorIndex: colorIndex([...ASSET_REGIONS], s.key),
    }));
  } else if (dimension === 'account') {
    slices = foldOthers(
      allocation(positions, (p) => p.asset.accountId).map((s) => ({
        ...s,
        label: accountName.get(s.key) ?? '—',
        colorIndex: colorIndex(accountOrder, s.key),
      })),
    );
  } else {
    slices = foldOthers(
      allocation(positions, (p) => p.asset.id).map((s) => ({
        ...s,
        label: positions.find((p) => p.asset.id === s.key)!.asset.name,
        colorIndex: colorIndex(assetOrder, s.key),
      })),
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Reparto</h2>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800" role="tablist">
          {DIMENSIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={dimension === d.key}
              onClick={() => setDimension(d.key)}
              className={cx(
                'rounded-md px-2.5 py-1 font-medium',
                dimension === d.key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <AllocationChart slices={slices} />
    </Card>
  );
}

/** Lo que no tiene color propio (más allá del 7.º) se agrupa en una sola porción «Otros». */
function foldOthers(slices: Slice[]): Slice[] {
  const own = slices.filter((s) => s.colorIndex !== null);
  const rest = slices.filter((s) => s.colorIndex === null);
  if (rest.length === 0) return own;
  const value = rest.reduce((a, s) => a + s.value, 0);
  const pct = Math.round(rest.reduce((a, s) => a + s.pct, 0) * 10) / 10;
  return [...own, { key: 'others', label: `Otros (${rest.length})`, value, pct, colorIndex: null }];
}

// ---- Lista por cuenta ----

function AccountSection({
  account,
  positions,
  onSelectAsset,
  onEditAccount,
}: {
  account: InvestmentAccount;
  positions: AssetPosition[];
  onSelectAsset: (id: number) => void;
  onEditAccount: () => void;
}) {
  const value = positions.reduce((s, p) => s + p.value, 0);
  return (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between px-1">
        <button type="button" onClick={onEditAccount} className="text-sm font-semibold text-slate-600 hover:underline dark:text-slate-300">
          {account.name}
        </button>
        <span className="text-sm text-slate-500 tabular-nums dark:text-slate-400">{formatEuros(value)}</span>
      </div>
      {positions.length === 0 ? (
        <Card className="py-3 text-sm text-slate-500 dark:text-slate-400">Sin activos.</Card>
      ) : (
        <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {positions.map((p) => (
            <button
              key={p.asset.id}
              type="button"
              onClick={() => onSelectAsset(p.asset.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.asset.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {ASSET_TYPE_LABELS[p.asset.type]}
                  {p.asset.ticker && ` · ${p.asset.ticker}`}
                  {p.valuedAt === null && p.contributed > 0 && ' · sin valorar'}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{formatEuros(p.value)}</p>
                <GainShort summary={p} />
              </div>
            </button>
          ))}
        </Card>
      )}
    </section>
  );
}

function GainShort({ summary }: { summary: PositionSummary }) {
  const { gain, gainPct } = summary;
  if (gainPct === null) return null;
  return (
    <p
      className={cx(
        'text-xs tabular-nums',
        gain > 0 ? 'text-emerald-700 dark:text-emerald-400' : gain < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500',
      )}
    >
      {gain > 0 ? '+' : gain < 0 ? '−' : ''}
      {formatEuros(Math.abs(gain))} · {gain > 0 ? '+' : ''}
      {formatPct(gainPct)}
    </p>
  );
}

function Archived({ assets, accounts }: { assets: InvestmentAsset[]; accounts: InvestmentAccount[] }) {
  const restoreAsset = useRestoreInvestmentAsset();
  const restoreAccount = useRestoreInvestmentAccount();
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="px-1 text-sm font-semibold text-slate-600 dark:text-slate-300"
      >
        Archivados ({assets.length + accounts.length}) {open ? '▴' : '▾'}
      </button>
      {open && (
        <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {accounts.map((a) => (
            <ArchivedRow
              key={`c${a.id}`}
              label={`${a.name} (cuenta)`}
              pending={restoreAccount.isPending}
              onRestore={() => restoreAccount.mutate(a.id)}
            />
          ))}
          {assets.map((a) => (
            <ArchivedRow
              key={`a${a.id}`}
              label={a.name}
              pending={restoreAsset.isPending}
              onRestore={() => restoreAsset.mutate(a.id)}
            />
          ))}
          <ErrorText error={restoreAsset.error ?? restoreAccount.error} />
        </Card>
      )}
    </section>
  );
}

function ArchivedRow({ label, pending, onRestore }: { label: string; pending: boolean; onRestore: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex-1 opacity-70">{label}</span>
      <Button variant="secondary" disabled={pending} onClick={onRestore}>
        Recuperar
      </Button>
    </div>
  );
}

// ---- Detalle de un activo ----

type Action = OperationKind | 'valuation';

const SOURCE_LABELS: Record<OperationKind, Record<OperationSource, string>> = {
  contribution: { month: 'Del dinero de este mes', bucket: 'De una hucha', none: 'Ya lo tenía invertido' },
  withdrawal: { month: 'Al dinero de este mes', bucket: 'A una hucha', none: 'Fuera de la app' },
  dividend: { month: 'Al dinero de este mes', bucket: 'A una hucha', none: 'Reinvertido' },
  fee: { none: 'Descontada de la inversión', month: 'Pagada del dinero del mes', bucket: 'Pagada de una hucha' },
};

const DEFAULT_SOURCE: Record<OperationKind, OperationSource> = {
  contribution: 'month',
  withdrawal: 'month',
  dividend: 'month',
  fee: 'none',
};

function AssetDetail({
  position,
  data,
  accounts,
  buckets,
  onClose,
}: {
  position: AssetPosition;
  data: InvestmentsData;
  accounts: InvestmentAccount[];
  buckets: Bucket[];
  onClose: () => void;
}) {
  const { asset } = position;
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState(false);
  const removeAsset = useDeleteInvestmentAsset();
  const removeOperation = useDeleteInvestmentOperation();
  const removeValuation = useDeleteInvestmentValuation();
  const confirm = useConfirm();
  const toast = useToast();
  const bucketName = new Map(buckets.map((b) => [b.id, b.name]));

  if (editing) return <AssetForm asset={asset} accounts={accounts} onDone={() => setEditing(false)} />;

  const history = [
    ...data.operations.filter((o) => o.assetId === asset.id).map((o) => ({ type: 'op' as const, date: o.date, id: o.id, op: o })),
    ...data.valuations.filter((v) => v.assetId === asset.id).map((v) => ({ type: 'val' as const, date: v.date, id: v.id, val: v })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  async function handleDelete() {
    const ok = await confirm({
      title: `¿Borrar «${asset.name}»?`,
      message: 'Si tiene historial se archivará para conservarlo.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const { archived } = await removeAsset.mutateAsync(asset.id);
      onClose();
      toast({ message: archived ? `«${asset.name}» archivado` : `«${asset.name}» borrado`, tone: 'info' });
    } catch {
      // El error se muestra abajo.
    }
  }

  const toggle = (a: Action) => setAction(action === a ? null : a);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-3xl font-bold tabular-nums">{formatEuros(position.value)}</p>
        <Gain summary={position} className="text-sm" />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {position.valuedAt ? `Valorado el ${dateLabel(position.valuedAt)}` : 'Sin valorar: se muestra lo aportado'}
          {position.valuedAt && position.valueIsEstimate && ' · más lo aportado después'}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Aportado" value={position.contributed} />
        <Stat label="Retirado" value={position.withdrawn} />
        <Stat label="Invertido ahora" value={position.netContributed} />
        {position.dividendsPaidOut + position.dividendsReinvested > 0 && (
          <Stat label="Dividendos" value={position.dividendsPaidOut + position.dividendsReinvested} />
        )}
        {position.feesPaid + position.feesInside > 0 && <Stat label="Comisiones" value={position.feesPaid + position.feesInside} />}
        {position.units !== null && (
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Participaciones</dt>
            <dd className="font-medium tabular-nums">{formatUnits(position.units)}</dd>
          </div>
        )}
      </dl>

      <div className="grid grid-cols-3 gap-2">
        <ActionButton active={action === 'contribution'} onClick={() => toggle('contribution')}>
          ＋ Aportar
        </ActionButton>
        <ActionButton active={action === 'withdrawal'} onClick={() => toggle('withdrawal')}>
          − Retirar
        </ActionButton>
        <ActionButton active={action === 'valuation'} onClick={() => toggle('valuation')}>
          € Valorar
        </ActionButton>
      </div>
      <div className="flex justify-center gap-4 text-xs">
        <button type="button" onClick={() => toggle('dividend')} className="text-emerald-700 underline dark:text-emerald-400">
          Apuntar dividendo
        </button>
        <button type="button" onClick={() => toggle('fee')} className="text-emerald-700 underline dark:text-emerald-400">
          Apuntar comisión
        </button>
      </div>

      {action === 'valuation' && <ValuationForm position={position} onDone={() => setAction(null)} />}
      {action && action !== 'valuation' && (
        <OperationForm key={action} asset={asset} kind={action} buckets={buckets} onDone={() => setAction(null)} />
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">Historial</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Aún no hay movimientos.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
            {history.map((h) => {
              if (h.type === 'val') {
                return (
                  <li key={`v${h.id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p>Valoración</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{dateLabel(h.date)}</p>
                    </div>
                    <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatEuros(h.val.valueCents)}</span>
                    <DeleteButton
                      label="Borrar valoración"
                      disabled={removeValuation.isPending}
                      onClick={() => removeValuation.mutate(h.id)}
                    />
                  </li>
                );
              }
              const o = h.op;
              const inflow = o.kind === 'contribution';
              const where =
                o.source === 'bucket' ? `${SOURCE_LABELS[o.kind].bucket}: ${bucketName.get(o.bucketId!) ?? '—'}` : SOURCE_LABELS[o.kind][o.source];
              return (
                <li key={`o${h.id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{o.note || OPERATION_KIND_LABELS[o.kind]}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {dateLabel(o.date)}
                      {o.note && ` · ${OPERATION_KIND_LABELS[o.kind]}`} · {where}
                      {o.units !== null && ` · ${formatUnits(o.units)} part.`}
                    </p>
                  </div>
                  <span
                    className={cx(
                      'font-semibold tabular-nums',
                      inflow ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300',
                    )}
                  >
                    {inflow ? '+' : '−'}
                    {formatEuros(o.amountCents)}
                  </span>
                  <DeleteButton
                    label="Borrar operación"
                    disabled={removeOperation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `¿Borrar esta ${OPERATION_KIND_LABELS[o.kind].toLowerCase()}?`,
                        message: o.source === 'bucket' ? 'El dinero volverá a la hucha.' : undefined,
                        confirmLabel: 'Borrar',
                        tone: 'danger',
                      });
                      if (ok) removeOperation.mutate(o.id);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <ErrorText error={removeOperation.error ?? removeValuation.error} />
      </section>

      <div className="flex justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button variant="danger" onClick={handleDelete} disabled={removeAsset.isPending}>
          Borrar
        </Button>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Editar
        </Button>
      </div>
      <ErrorText error={removeAsset.error} />
    </div>
  );
}

function ActionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <Button variant={active ? 'primary' : 'secondary'} onClick={onClick} className="px-2">
      {children}
    </Button>
  );
}

function DeleteButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="danger" className="px-2 py-1" aria-label={label} disabled={disabled} onClick={onClick}>
      ✕
    </Button>
  );
}

// ---- Formularios ----

function OperationForm({
  asset,
  kind,
  buckets,
  onDone,
}: {
  asset: InvestmentAsset;
  kind: OperationKind;
  buckets: Bucket[];
  onDone: () => void;
}) {
  const create = useCreateInvestmentOperation();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [source, setSource] = useState<OperationSource>(DEFAULT_SOURCE[kind]);
  const [bucketId, setBucketId] = useState<number | ''>(buckets[0]?.id ?? '');
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const withUnits = kind === 'contribution' || kind === 'withdrawal';
  const sources: OperationSource[] = kind === 'fee' ? ['none', 'month', 'bucket'] : ['month', 'bucket', 'none'];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = parseEuros(amount);
    if (amountCents === null || amountCents <= 0) return setError('Escribe un importe válido');
    const parsedUnits = withUnits && units.trim() ? parseUnits(units) : null;
    if (withUnits && units.trim() && parsedUnits === null) return setError('Participaciones no válidas (hasta 8 decimales)');
    if (source === 'bucket' && bucketId === '') return setError('Elige la hucha');
    try {
      await create.mutateAsync({
        assetId: asset.id,
        date,
        kind,
        amountCents,
        units: parsedUnits,
        source,
        bucketId: source === 'bucket' ? Number(bucketId) : null,
        note,
      });
      toast({ message: `${OPERATION_KIND_LABELS[kind]} apuntada`, tone: 'success' });
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Importe">
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <Field label={kind === 'contribution' || kind === 'fee' ? '¿De dónde sale el dinero?' : '¿Adónde va el dinero?'}>
        <Select value={source} onChange={(e) => setSource(e.target.value as OperationSource)}>
          {sources.map((s) => (
            <option key={s} value={s} disabled={s === 'bucket' && buckets.length === 0}>
              {SOURCE_LABELS[kind][s]}
            </option>
          ))}
        </Select>
      </Field>
      {source === 'bucket' && (
        <Field label="Hucha">
          <Select value={bucketId} onChange={(e) => setBucketId(Number(e.target.value))}>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.icon} {b.name} ({formatEuros(b.balanceCents)})
              </option>
            ))}
          </Select>
        </Field>
      )}
      {withUnits && (
        <Field label="Participaciones (opcional)" hint="Si las sabes, podrás valorar con el precio por participación.">
          <Input inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" />
        </Field>
      )}
      <Field label="Nota (opcional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <ErrorText error={create.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

function ValuationForm({ position, onDone }: { position: AssetPosition; onDone: () => void }) {
  const save = useSaveInvestmentValuation();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Con participaciones, el valor se puede calcular desde el precio (que puede tener más de 2 decimales).
  function handlePrice(input: string) {
    setPrice(input);
    const p = Number(input.replace(/\s/g, '').replace(',', '.'));
    if (position.units !== null && Number.isFinite(p) && p > 0) {
      const cents = unitsValue(position.units, p * 100);
      setValue((cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valueCents = parseEuros(value);
    if (valueCents === null || valueCents < 0) return setError('Escribe un valor válido');
    try {
      await save.mutateAsync({ assetId: position.asset.id, date, valueCents });
      toast({ message: 'Valoración guardada', tone: 'success' });
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor total" hint="El que te muestra el bróker.">
          <MoneyInput value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      {position.units !== null && position.units > 0 && (
        <Field label="O precio por participación" hint={`Tienes ${formatUnits(position.units)} participaciones.`}>
          <Input inputMode="decimal" value={price} onChange={(e) => handlePrice(e.target.value)} placeholder="0,00" />
        </Field>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <ErrorText error={save.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

/** Clase de activo más habitual para cada tipo (se puede cambiar). */
const CLASS_FOR_TYPE: Record<AssetType, AssetClass> = {
  index_fund: 'equity',
  fund: 'equity',
  etf: 'equity',
  stock: 'equity',
  crypto: 'crypto',
  pension: 'equity',
  deposit: 'money_market',
  other: 'other',
};

const NEW_ACCOUNT = -1;

function AssetForm({
  asset,
  accounts,
  onDone,
}: {
  asset?: InvestmentAsset;
  accounts: InvestmentAccount[];
  onDone: () => void;
}) {
  const createAccount = useCreateInvestmentAccount();
  const createAsset = useCreateInvestmentAsset();
  const updateAsset = useUpdateInvestmentAsset();
  const [accountId, setAccountId] = useState<number>(asset?.accountId ?? accounts[0]?.id ?? NEW_ACCOUNT);
  const [accountName, setAccountName] = useState('');
  const [name, setName] = useState(asset?.name ?? '');
  const [ticker, setTicker] = useState(asset?.ticker ?? '');
  const [type, setType] = useState<AssetType>(asset?.type ?? 'index_fund');
  const [assetClass, setAssetClass] = useState<AssetClass>(asset?.assetClass ?? 'equity');
  const [region, setRegion] = useState(asset?.region ?? 'global');
  const pending = createAccount.isPending || createAsset.isPending || updateAsset.isPending;
  const error = createAccount.error ?? createAsset.error ?? updateAsset.error;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      let targetAccount = accountId;
      if (accountId === NEW_ACCOUNT) {
        const created = await createAccount.mutateAsync({ name: accountName });
        targetAccount = created.id;
      }
      const input = { accountId: targetAccount, name, ticker, type, assetClass, region };
      if (asset) await updateAsset.mutateAsync({ id: asset.id, ...input });
      else await createAsset.mutateAsync(input);
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="Nombre" hint="P. ej. «Fondo indexado S&P 500».">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
      </Field>
      <Field label="Cuenta o bróker">
        <Select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value={NEW_ACCOUNT}>+ Nueva cuenta…</option>
        </Select>
      </Field>
      {accountId === NEW_ACCOUNT && (
        <Field label="Nombre de la cuenta" hint="P. ej. «MyInvestor» o «Trade Republic».">
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} required maxLength={40} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as AssetType;
              setType(t);
              if (!asset) setAssetClass(CLASS_FOR_TYPE[t]);
            }}
          >
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {ASSET_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ISIN o ticker (opcional)">
          <Input value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={20} />
        </Field>
        <Field label="Clase">
          <Select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>
                {ASSET_CLASS_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Región">
          <Select value={region} onChange={(e) => setRegion(e.target.value as typeof region)}>
            {ASSET_REGIONS.map((r) => (
              <option key={r} value={r}>
                {ASSET_REGION_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorText error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

function AccountForm({ account, onDone }: { account: InvestmentAccount; onDone: () => void }) {
  const update = useUpdateInvestmentAccount();
  const remove = useDeleteInvestmentAccount();
  const confirm = useConfirm();
  const toast = useToast();
  const [name, setName] = useState(account.name);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: account.id, name });
      onDone();
    } catch {
      // El error se muestra abajo.
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `¿Borrar «${account.name}»?`,
      message: 'Si tiene activos se archivará para conservar el historial.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const { archived } = await remove.mutateAsync(account.id);
      onDone();
      toast({ message: archived ? `«${account.name}» archivada` : `«${account.name}» borrada`, tone: 'info' });
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
      </Field>
      <ErrorText error={update.error ?? remove.error} />
      <div className="flex justify-between gap-2">
        <Button variant="danger" onClick={handleDelete} disabled={remove.isPending}>
          Borrar
        </Button>
        <Button type="submit" disabled={update.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
