import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useRef,
} from 'react';
import { twMerge } from 'tailwind-merge';
import { addMonths, currentMonth, monthLabel } from '@contapp/shared';

/** Une clases de Tailwind; si dos chocan (p. ej. w-full y w-40), gana la última. */
export function cx(...classes: (string | false | null | undefined)[]) {
  return twMerge(classes.filter(Boolean).join(' '));
}

// ---- Botones ----

const buttonVariants = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50',
  secondary:
    'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950',
  dangerSolid: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/50',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

// ---- Formularios ----

export const inputClass =
  'w-full rounded-lg border-0 bg-white px-3 py-2 text-base ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:bg-slate-900 dark:ring-slate-700';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputClass, className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // La ayuda va fuera del <label> para que no forme parte del nombre accesible del campo.
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/** Input de importe en euros: texto con teclado decimal en el móvil. */
export function MoneyInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <div className="relative">
      <Input inputMode="decimal" autoComplete="off" placeholder="0,00" className={cx('pr-8', className)} {...props} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">€</span>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="text-sm text-rose-600 dark:text-rose-400">{message}</p>;
}

// ---- Layout ----

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

export function FullScreenMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-center text-slate-500">{children}</div>;
}

// ---- Modal ----

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/50 dark:bg-slate-900 dark:text-slate-100"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button variant="ghost" onClick={onClose} aria-label="Cerrar" className="-mr-2 px-2">
              ✕
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// ---- Selector de mes ----

export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" className="px-2" onClick={() => onChange(addMonths(month, -1))} aria-label="Mes anterior">
        ‹
      </Button>
      <button
        type="button"
        onClick={() => onChange(currentMonth())}
        className={cx('min-w-36 text-center font-medium first-letter:uppercase', !isCurrent && 'text-emerald-600')}
        title={isCurrent ? undefined : 'Volver al mes actual'}
      >
        {monthLabel(month)}
      </button>
      <Button variant="ghost" className="px-2" onClick={() => onChange(addMonths(month, 1))} aria-label="Mes siguiente">
        ›
      </Button>
    </div>
  );
}
