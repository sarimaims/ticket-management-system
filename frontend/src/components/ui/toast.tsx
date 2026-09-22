"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  MessageSquare,
  RefreshCw,
  TicketPlus,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastTone = "error" | "success" | "info" | "ticket" | "update" | "message";

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Where clicking the toast takes the reader, if anywhere. */
  href?: string;
};
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
  // A ticket arriving is the loudest thing that happens here, so it wears the
  // brand colour; an update to one you already know about is quieter.
  ticket: { box: "border-brand-200 bg-brand-50 text-brand-700", icon: TicketPlus },
  update: {
    box: "border-status-progress-fg/20 bg-status-progress-bg text-status-progress-fg",
    icon: RefreshCw,
  },
  // Somebody talking on a ticket: the brand voice, but unfilled, so it is not
  // mistaken for a ticket arriving.
  message: { box: "border-brand-200 bg-surface text-brand-700", icon: MessageSquare },
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
    ({ title, description, tone = "error", href }: ToastInput) => {
      nextId.current += 1;
      const id = nextId.current;
      // Three is as many as anyone reads at once; older ones make room.
      setToasts((current) => [...current.slice(-2), { id, title, description, tone, href }]);
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
        className="pointer-events-none fixed top-[4.5rem] right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
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
              {/* A toast with somewhere to go is clickable in full, so the
                  reader does not have to find the page it is about. */}
              <Body
                href={toast.href}
                onNavigate={() => dismiss(toast.id)}
                title={toast.title}
                description={toast.description}
              />
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

function Body({
  href,
  onNavigate,
  title,
  description,
}: {
  href?: string;
  onNavigate: () => void;
  title: string;
  description?: string;
}) {
  const content = (
    <>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-0.5 text-[13px] leading-snug opacity-80">{description}</p>}
    </>
  );

  if (!href) return <div className="min-w-0 flex-1">{content}</div>;

  return (
    <Link
      href={href as "/"}
      onClick={onNavigate}
      className="min-w-0 flex-1 text-left transition-opacity hover:opacity-80"
    >
      {content}
    </Link>
  );
}

export function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}
