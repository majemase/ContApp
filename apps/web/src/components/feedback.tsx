import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button, cx } from './ui';

// Sustitutos con el estilo de la app para window.confirm() y window.alert():
//   const confirm = useConfirm();  if (await confirm({ title: '¿Borrar?' })) …
//   const toast = useToast();      toast({ message: 'Guardado', tone: 'success' })

// ---- Tipos ----

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' para acciones destructivas (borrar…). */
  tone?: 'danger' | 'default';
}

export interface ToastOptions {
  message: string;
  tone?: 'success' | 'info' | 'error';
  /** Botón opcional dentro del aviso, p. ej. "Deshacer". */
  action?: { label: string; onClick: () => void };
  /** Milisegundos hasta que desaparece. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface FeedbackApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (options: ToastOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('Falta <FeedbackProvider> en el árbol de componentes');
  return ctx;
}

export const useConfirm = () => useFeedback().confirm;
export const useToast = () => useFeedback().toast;

// ---- Provider ----

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    // Máximo 2 a la vez para no tapar la pantalla: los más antiguos se descartan.
    setToasts((list) => [...list.slice(-1), { ...options, id }]);
  }, []);

  function close(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      <ConfirmDialog options={pending} onClose={close} />
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

// ---- Diálogo de confirmación ----

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions | null; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = options !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const danger = options?.tone === 'danger';

  return (
    <dialog
      ref={ref}
      // Escape o clic fuera = cancelar.
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      onClick={(e) => e.target === ref.current && onClose(false)}
      className="animate-pop-in m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-[2px] dark:bg-slate-900 dark:text-slate-100"
    >
      {options && (
        <div className="p-6 text-center">
          <div
            className={cx(
              'mx-auto mb-4 flex size-12 items-center justify-center rounded-full',
              danger
                ? 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'
                : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
            )}
          >
            {danger ? <TrashIcon /> : <QuestionIcon />}
          </div>
          <h2 className="text-lg font-semibold">{options.title}</h2>
          {options.message && (
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">{options.message}</div>
          )}
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => onClose(false)} className="py-2.5">
              {options.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button
              variant={danger ? 'dangerSolid' : 'primary'}
              onClick={() => onClose(true)}
              className="py-2.5"
              autoFocus
            >
              {options.confirmLabel ?? 'Aceptar'}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// ---- Avisos (toasts) ----

const TOAST_STYLES = {
  success: { icon: <CheckIcon />, iconClass: 'bg-emerald-500 text-white' },
  info: { icon: <InfoIcon />, iconClass: 'bg-sky-500 text-white' },
  error: { icon: <AlertIcon />, iconClass: 'bg-rose-500 text-white' },
};

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const style = TOAST_STYLES[toast.tone ?? 'info'];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration ?? (toast.action ? 6000 : 4000));
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      role="status"
      className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl bg-slate-900 py-2.5 pr-2 pl-3 text-sm text-white shadow-lg ring-1 ring-white/10 dark:bg-slate-800"
    >
      <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full', style.iconClass)}>
        {style.icon}
      </span>
      <p className="flex-1">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            onDismiss(toast.id);
          }}
          className="rounded-md px-2 py-1 font-semibold text-emerald-400 hover:bg-white/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar aviso"
        className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

// ---- Iconos ----

const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
} as const;

function TrashIcon() {
  return (
    <svg {...iconProps} className="size-6">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg {...iconProps} className="size-6">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} strokeWidth={3} className="size-3.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg {...iconProps} strokeWidth={3} className="size-3.5">
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...iconProps} strokeWidth={3} className="size-3.5">
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
