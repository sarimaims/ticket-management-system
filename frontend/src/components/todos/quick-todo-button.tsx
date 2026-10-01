"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pencil } from "lucide-react";

/**
 * A pencil in the corner of every page: jot a to-do down without losing your
 * place for long. It opens the board with the new to-do dialog already up.
 *
 * Left off the board itself, which has its own Add buttons a glance away.
 */
export function QuickTodoButton() {
  const pathname = usePathname();
  if (pathname === "/todo") return null;

  return (
    <Link
      href="/todo?new=1"
      aria-label="Add a to-do"
      className="group fixed right-5 bottom-5 z-30 grid size-12 place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition-all hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-brand-500/30 focus-visible:outline-none"
    >
      <Pencil className="size-5 transition-transform group-hover:-rotate-12" />

      {/* A label that rises above it on hover or keyboard focus, in
          place of the browser's own tooltip - which is slow, small, and looks
          like nothing else in the app. */}
      <span
        role="tooltip"
        // Right-aligned with the button: it sits at the edge of the screen, so a
        // label centred over it would run off the side.
        className="pointer-events-none absolute right-0 bottom-full mb-3 flex translate-y-1 items-center gap-2 rounded-lg border border-line bg-gradient-to-b from-white to-ink-50 px-3 py-2 whitespace-nowrap text-ink-900 opacity-0 shadow-[0_10px_30px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.08)] transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
      >
        <span className="text-[12px] font-semibold">Add a to-do</span>
        <span className="text-[11px] text-ink-500">opens your board</span>
        {/* The little arrow, down at the middle of the button (24px in, the button being 48). */}
        <span className="absolute right-5 -bottom-1 size-2 rotate-45 border-r border-b border-line bg-ink-50" />
      </span>
    </Link>
  );
}
