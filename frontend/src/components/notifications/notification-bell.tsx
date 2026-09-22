"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, CheckCheck, Volume2, VolumeX } from "lucide-react";

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
          className="relative grid size-8 place-items-center rounded-md text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={open}
        >
          <Bell className="size-4.5" />
          {/* A dot, not a counter: the number is in the panel, and a badge of
              digits on a 32px button is a lot of noise for "there is something". */}
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand-600 ring-2 ring-surface" />
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-50 mt-1.5 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-lg shadow-ink-900/10">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <p className="flex items-baseline gap-1.5">
                <span className="text-[12px] font-bold text-ink-900">Notifications</span>
                {unread > 0 && (
                  <span className="text-[11px] font-semibold text-brand-600">{unread} new</span>
                )}
              </p>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleSound(muted, setMuted)}
                  className="grid size-6 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                  aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
                  title={muted ? "Sound off" : "Sound on"}
                >
                  {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="grid size-6 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                  aria-label="Mark all read"
                  title="Mark all read"
                >
                  <CheckCheck className="size-3.5" />
                </button>
              </div>
            </div>

            {preview.length === 0 ? (
              <div className="px-4 py-7 text-center">
                <span className="mx-auto grid size-8 place-items-center rounded-full bg-ink-100">
                  <Bell className="size-4 text-ink-400" />
                </span>
                <p className="mt-2 text-[12px] font-semibold text-ink-700">Nothing yet</p>
                <p className="mt-0.5 text-[11px] text-ink-400">
                  Tickets raised to your department show up here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line">
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
                "flex w-full items-center justify-center gap-1 border-t border-line px-4 py-2",
                "text-[11.5px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900",
              )}
            >
              See all
              {items.length > PREVIEW && <span className="text-ink-400">({items.length})</span>}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <NotificationSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
