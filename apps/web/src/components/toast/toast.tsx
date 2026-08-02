import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ToastVariant = "default" | "success" | "error";

interface ToastEntry {
  readonly id: string;
  readonly message: string;
  readonly variant: ToastVariant;
}

export interface ToastOptions {
  readonly variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. Default 2500. */
  readonly durationMs?: number;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const VARIANT_CLASSES: Readonly<Record<ToastVariant, string>> = {
  default: "border-border bg-card text-card-foreground",
  success: "border-success/30 bg-success/10 text-success",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

/**
 * App-wide toast host. Mount once (see `AppProviders`); any page calls
 * `useToast().show(message)` instead of hand-rolling local `notice` state +
 * `window.setTimeout`.
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions): void => {
      const id = crypto.randomUUID();
      const variant = options?.variant ?? "default";
      const durationMs = options?.durationMs ?? 2500;
      setToasts((prev) => [...prev, { id, message, variant }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), durationMs),
      );
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto max-w-md whitespace-pre-line rounded-md border px-3 py-2 text-sm shadow-lg",
              VARIANT_CLASSES[toast.variant],
            )}
          >
            {toast.message}
          </p>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
