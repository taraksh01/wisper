import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import "./Toast.css";

interface Toast {
  id: number;
  message: string;
  type: "info" | "success" | "error";
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type: Toast["type"], duration?: number) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const MAX = 3;

  const addToast = useCallback((message: string, type: Toast["type"] = "info", duration = 4000) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, type, duration }].slice(-MAX));
    if (duration > 0) {
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration);
    }
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-in toast--${t.type}`}
          >
            <span className="toast__dot" />
            <span className="toast__msg">{t.message}</span>
            <button onClick={() => removeToast(t.id)} className="toast__close" aria-label="Dismiss">×</button>
            {t.duration > 0 && (
              <span className="toast__bar" style={{ animationDuration: `${t.duration}ms` }} />
            )}
          </div>
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