"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, BellOff, CheckCheck, Volume2 } from "lucide-react";

import { useNotifications } from "@/components/notifications/notification-provider";
import { NotificationCard, toggleSound } from "@/components/notifications/notification-shared";
import { NotificationSheet } from "@/components/notifications/notification-sheet";
import { cn } from "@/lib/utils";

/** The dropdown is a preview; the sheet holds the rest. */
const PREVIEW = 4;

/**
 * The bell and its short feed. Opening the panel does not clear anything: a
 * notification is read when it is opened, or when "mark all read" says so, so
 * the unread state survives a glance and the Unread filter still means
 * something.
 */
export function NotificationBell() {
  const { items, unread, muted, setMuted, markAllRead, markOneRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const preview = items.slice(0, PREVIEW);

  return (
    <>
      <div ref={root} className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="relative grid size-10 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={open}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-50 mt-2 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line bg-surface shadow-xl shadow-ink-900/10">
            <div className="flex items-center justify-between gap-2 px-3.5 py-3">
              <p className="flex items-center gap-2 text-sm font-bold text-ink-900">
                Notifications
                {unread > 0 && (
                  <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {unread}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleSound(muted, setMuted)}
                  className="grid size-7 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                  aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
                  title={muted ? "Sound off" : "Sound on"}
                >
                  {muted ? <BellOff className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="grid size-7 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                  aria-label="Mark all read"
                  title="Mark all read"
                >
                  <CheckCheck className="size-4" />
                </button>
              </div>
            </div>

            {preview.length === 0 ? (
              <div className="px-4 pt-2 pb-8 text-center">
                <span className="mx-auto grid size-10 place-items-center rounded-full bg-ink-100">
                  <Bell className="size-4.5 text-ink-400" />
                </span>
                <p className="mt-2.5 text-sm font-semibold text-ink-700">Nothing yet</p>
                <p className="mt-0.5 text-xs text-ink-400">
                  Tickets raised to your department show up here.
                </p>
              </div>
            ) : (
              <div className="space-y-1 px-2 pb-2">
                {preview.map((item) => (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    onNavigate={() => setOpen(false)}
                    onRead={markOneRead}
                    compact
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSheetOpen(true);
              }}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-2.5",
                "text-[13px] font-bold text-brand-600 transition-colors hover:bg-brand-50",
              )}
            >
              See all
              {items.length > PREVIEW && (
                <span className="font-semibold text-ink-400">({items.length})</span>
              )}
              <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <NotificationSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
