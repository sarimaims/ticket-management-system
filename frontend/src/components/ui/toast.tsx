"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastTone = "error" | "success" | "info";

type ToastInput = { title: string; description?: string; tone?: ToastTone };
type Toast = ToastInput & { id: number; tone: ToastTone };

/** Long enough to read two lines, short enough to stay out of the way. */
const DURATION = 5000;

const TONES: Record<ToastTone, { box: string; icon: React.ComponentType<{ className?: string }> }> = {
  error: { box: "border-brand-200 bg-brand-50 text-brand-700", icon: AlertCircle },
  success: {
    box: "border-status-completed-fg/20 bg-status-completed-bg text-status-completed-fg",
    icon: CheckCircle2,
  },
  info: { box: "border-line-strong bg-surface text-ink-700", icon: Info },
};

type ToastApi = {
  show: (toast: ToastInput) => void;
  error: (title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toasts live at the top right of the viewport, below the topbar, so a
 * validation message is visible no matter how far down the form the reader is.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    ({ title, description, tone = "error" }: ToastInput) => {
      nextId.current += 1;
      const id = nextId.current;
      // Three is as many as anyone reads at once; older ones make room.
      setToasts((current) => [...current.slice(-2), { id, title, description, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      error: (title, description) => show({ title, description, tone: "error" }),
      success: (title, description) => show({ title, description, tone: "success" }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div
        aria-live="assertive"
        className="pointer-events-none fixed top-20 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const tone = TONES[toast.tone];
          const Icon = tone.icon;
          return (
            <div
              key={toast.id}
              role="alert"
              className={cn(
                "pointer-events-auto flex animate-toast-in items-start gap-2.5 rounded-field border px-3.5 py-3 shadow-lg shadow-ink-900/5",
                tone.box,
              )}
            >
              <Icon className="mt-0.5 size-4.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-[13px] leading-snug opacity-80">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-mr-1 shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}
