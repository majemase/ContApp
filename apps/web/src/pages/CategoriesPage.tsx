import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import type { Category } from '@contapp/shared';
import { useCategories, useCreateCategory, useDeleteCategory, useRestoreCategory, useUpdateCategory } from '../api';
import { CATEGORY_COLORS, CategoryIcon } from '../components/categories';
import { useConfirm, useToast } from '../components/feedback';
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, PageHeader, cx } from '../components/ui';

export function CategoriesPage() {
  const query = useCategories(true);
  const restore = useRestoreCategory();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const categories = query.data ?? [];
  const active = categories.filter((c) => !c.archived);
  const archived = categories.filter((c) => c.archived);

  return (
    <>
      <Link to="/ajustes" className="-mb-2 inline-block text-sm text-emerald-600 dark:text-emerald-400">
        ‹ Ajustes
      </Link>
      <PageHeader title="Categorías" action={<Button onClick={() => setEditing('new')}>+ Nueva</Button>} />

      {query.isPending ? (
        <EmptyState>Cargando…</EmptyState>
      ) : query.error ? (
        <ErrorText error={query.error} />
      ) : (
        <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {active.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <CategoryIcon category={c} />
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-slate-400">›</span>
            </button>
          ))}
          {active.length === 0 && <EmptyState>No hay categorías.</EmptyState>}
        </Card>
      )}

      {archived.length > 0 && (
        <section className="space-y-1">
          <h2 className="px-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Archivadas</h2>
          <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
            Tienen gastos asociados, por eso no se borran. No aparecen al apuntar gastos nuevos.
          </p>
          <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
            {archived.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
                <CategoryIcon category={c} />
                <span className="flex-1">{c.name}</span>
                <Button variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate(c.id)}>
                  Recuperar
                </Button>
              </div>
            ))}
          </Card>
          <ErrorText error={restore.error} />
        </section>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Nueva categoría' : 'Editar categoría'}
      >
        {editing !== null && (
          <CategoryEditor category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        )}
      </Modal>
    </>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const confirm = useConfirm();
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [color, setColor] = useState(category?.color ?? 'slate');
  const mutation = category ? update : create;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const input = { name, icon: icon.trim(), color };
    try {
      if (category) await update.mutateAsync({ ...input, id: category.id });
      else await create.mutateAsync(input);
      onClose();
    } catch {
      // El error se muestra desde la mutación.
    }
  }

  async function handleDelete() {
    if (!category) return;
    const ok = await confirm({
      title: `¿Borrar la categoría «${category.name}»?`,
      message: 'Si tiene gastos asociados, se archivará en lugar de borrarse para no perder el histórico.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const { archived } = await remove.mutateAsync(category.id);
      onClose();
      toast(
        archived
          ? { message: `«${category.name}» tiene gastos, así que se ha archivado`, tone: 'info' }
          : { message: `Categoría «${category.name}» borrada`, tone: 'success' },
      );
    } catch {
      // El error se muestra desde la mutación.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <div className="w-16 shrink-0">
          <Field label="Icono">
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={8}
              placeholder="🙂"
              className="text-center text-xl"
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus={!category} />
          </Field>
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">
        Para el icono, pega un emoji (en Windows: tecla Windows + punto).
      </p>

      <div className="space-y-1">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Color</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CATEGORY_COLORS).map(([key, { swatch }]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              onClick={() => setColor(key)}
              className={cx(
                'size-8 rounded-full',
                swatch,
                color === key && 'ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-slate-900',
              )}
            />
          ))}
        </div>
      </div>

      <ErrorText error={mutation.error ?? remove.error} />
      <div className="flex items-center justify-between gap-2">
        {category ? (
          <Button variant="danger" onClick={handleDelete} disabled={remove.isPending}>
            Borrar
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : category ? 'Guardar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}
