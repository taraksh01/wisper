import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from "react";
import { IconCheck, IconClose, IconCloseSmall, IconAbout } from "./ui/icons";

type ToastType = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, duration?: number) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;

const typeStyles: Record<ToastType, { icon: typeof IconCheck; chip: string; bar: string }> = {
  success: { icon: IconCheck, chip: "bg-ready/15 text-ready", bar: "bg-ready" },
  error: { icon: IconClose, chip: "bg-recording/15 text-recording", bar: "bg-recording" },
  info: { icon: IconAbout, chip: "bg-accent/15 text-accent", bar: "bg-accent" },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remainingRef = useRef(toast.duration);
  const startedRef = useRef(Date.now());

  const clear = () => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  const arm = useCallback(() => {
    if (toast.duration <= 0) return;
    clear();
    startedRef.current = Date.now();
    timerRef.current = setTimeout(onDismiss, remainingRef.current);
  }, [toast.duration, onDismiss]);

  // start countdown on mount, clean up on unmount
  useEffect(() => {
    arm();
    return clear;
  }, [arm]);

  const pause = () => {
    if (timerRef.current === undefined) return;
    clear();
    remainingRef.current -= Date.now() - startedRef.current;
  };

  const resume = () => {
    if (toast.duration <= 0) return;
    arm();
  };

  const s = typeStyles[toast.type];
  const Icon = s.icon;

  return (
    <div
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
      className="toast-enter pointer-events-auto relative flex items-start gap-3 w-[340px] rounded-[var(--radius-card)] border border-stroke bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_var(--color-stroke-soft)] p-3.5 overflow-hidden"
    >
      <span className={`shrink-0 w-7 h-7 grid place-items-center rounded-full ${s.chip}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <p className="flex-1 text-xs leading-relaxed text-ink pt-1.5 break-words">{toast.message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 p-0.5 text-muted/50 hover:text-ink transition-colors cursor-pointer"
      >
        <IconCloseSmall className="w-3.5 h-3.5" />
      </button>
      {toast.duration > 0 && (
        <span
          className={`toast-progress absolute bottom-0 left-0 h-[2px] w-full ${s.bar}`}
          style={{ animationDuration: `${toast.duration}ms` }}
        />
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const removeToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "info", duration = 4000) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, type, duration }].slice(-MAX_TOASTS));
  }, []);

  const value = useMemo(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-12 right-4 z-[200] flex flex-col items-end gap-2 pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
