"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building, Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** How tall the panel is allowed to be, and when it flips above its trigger. */
const PANEL_HEIGHT = 320;

export type ScopeOption = {
  id: string;
  name: string;
  unit: { id: string; name: string } | null;
  /** How many of the rows in view sit here, shown beside the name. */
  count: number;
};

export type ScopeValue = { units: string[]; departments: string[] };

const EMPTY: ScopeValue = { units: [], departments: [] };

/** The tick box both columns share, so a unit and a department read alike. */
function Box({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded border transition-colors",
        checked ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface",
      )}
    >
      {checked && <Check className="size-2.5" strokeWidth={3.5} />}
    </span>
  );
}

/**
 * One filter for both halves of the question "where".
 *
 * A unit and a department are the same axis at two depths, and two separate
 * pickers side by side made people set one, get an empty table, and go looking
 * for the other. Here a unit is a row you can tick, with its departments
 * nested under it - tick the unit for everything in it, or reach in and take
 * two of its departments.
 */
export function ScopeFilter({
  options,
  value,
  onChange,
  id,
  className,
}: {
  options: ScopeOption[];
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  /** The unit under the pointer, whose departments fill the second pane. */
  const [hovered, setHovered] = useState<string | null>(null);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  /** Shutting it also forgets what was typed: the next open starts clean. */
  const close = () => {
    setOpen(false);
    setTerm("");
    setHovered(null);
  };

  /** Drawn on the body, so a toolbar with its own scrollbar cannot clip it. */
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;

    const room = window.innerHeight - rect.bottom;
    setAt({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 448)),
      ...(room > PANEL_HEIGHT
        ? { top: rect.bottom + 4 }
        : { bottom: Math.max(8, window.innerHeight - rect.top + 4) }),
    });
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const inRoot = root.current?.contains(event.target as Node);
      const inPanel = (event.target as HTMLElement).closest?.("[data-scope-panel]");
      if (!inRoot && !inPanel) close();
    };
    const onScroll = () => close();
    const onResize = () => place();
    // Caught on the way down: a sheet behind this closes on Escape too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    // Focus is a DOM call, not state: opening the panel should put the cursor
    // where typing already works.
    if (open) search.current?.focus();
  }, [open]);

  /** Departments under their unit, with the unit's own total. */
  const groups = useMemo(() => {
    const byUnit = new Map<
      string,
      { id: string; name: string; count: number; departments: ScopeOption[] }
    >();

    for (const option of options) {
      const key = option.unit?.id ?? "none";
      const group = byUnit.get(key) ?? {
        id: key,
        name: option.unit?.name ?? "No unit",
        count: 0,
        departments: [],
      };
      group.count += option.count;
      group.departments.push(option);
      byUnit.set(key, group);
    }

    return [...byUnit.values()]
      .map((group) => ({
        ...group,
        departments: group.departments.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [options]);

  const needle = term.trim().toLowerCase();

  const shown = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        // A unit that matches keeps all of its departments; otherwise only the
        // departments that match themselves.
        departments: group.name.toLowerCase().includes(needle)
          ? group.departments
          : group.departments.filter((item) => item.name.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.departments.length > 0 || group.name.toLowerCase().includes(needle));
  }, [groups, needle]);

  /**
   * What a search answers with: the units that match, then the departments
   * that match by their own name.
   *
   * Typing a department name and being shown only the unit it lives in is the
   * answer to a question nobody asked, so a department comes back as itself,
   * wearing its unit as a pill - which is also what tells two departments of
   * the same name apart.
   */
  const hits = useMemo(() => {
    if (!needle) return { units: [], departments: [] };
    return {
      units: groups.filter((group) => group.name.toLowerCase().includes(needle)),
      departments: options
        .filter((option) => option.name.toLowerCase().includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [groups, options, needle]);

  const nothingFound = needle !== "" && hits.units.length === 0 && hits.departments.length === 0;

  const openUnit = shown.find((group) => group.id === hovered) ?? null;

  const picked = value.units.length + value.departments.length;

  const summary = () => {
    if (picked === 0) return "All departments";
    if (value.units.length === 1 && value.departments.length === 0) {
      return groups.find((group) => group.id === value.units[0])?.name ?? "1 unit";
    }
    if (value.departments.length === 1 && value.units.length === 0) {
      return options.find((option) => option.id === value.departments[0])?.name ?? "1 department";
    }
    return `${picked} selected`;
  };

  const toggle = (key: "units" | "departments", item: string) => {
    const list = value[key];
    onChange({
      ...value,
      [key]: list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item],
    });
  };

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        ref={trigger}
        type="button"
        onClick={() => {
          if (open) {
            close();
            return;
          }
          place();
          setOpen(true);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md border px-2.5",
          "text-[13px] font-medium transition-colors",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10 focus:outline-none",
          // A filter that is doing something says so on the toolbar, rather
          // than looking identical to the three that are not.
          picked > 0
            ? "border-brand-200 bg-brand-50/60 text-brand-700"
            : "border-line-strong bg-surface text-ink-900",
          open && "border-brand-400",
          className,
        )}
      >
        <Building className={cn("size-4 shrink-0", picked > 0 ? "text-brand-500" : "text-ink-400")} />
        <span
          className={cn("min-w-0 flex-1 truncate text-left", picked === 0 && "text-ink-400")}
        >
          {summary()}
        </span>

        {picked > 0 && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear this filter"
            onClick={(event) => {
              event.stopPropagation();
              onChange(EMPTY);
            }}
            className="grid size-4 shrink-0 place-items-center rounded-full text-brand-400 transition-colors hover:bg-brand-100 hover:text-brand-700"
          >
            <X className="size-3" strokeWidth={3} />
          </span>
        )}

        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open &&
        at &&
        createPortal(
          // The units column is the panel. The departments of whichever unit
          // is under the pointer grow onto its side, and nothing is drawn
          // there until one is - an empty half is a question nobody asked.
          <div
            data-scope-panel
            style={{ left: at.left, top: at.top, bottom: at.bottom }}
            className="fixed z-50 flex h-80 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-ink-900/15"
          >
            <div className="flex w-72 shrink-0 flex-col">
              <div className="relative border-b border-line">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  ref={search}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search units and departments"
                  aria-label="Search units and departments"
                  className="h-10 w-full bg-transparent pr-3 pl-9 text-[13px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-1.5">
                {(needle ? nothingFound : shown.length === 0) && (
                  <p className="px-2 py-6 text-center text-[12px] text-ink-400">
                    {/* An empty list and an empty search are different problems. */}
                    {needle ? <>Nothing matches &ldquo;{term}&rdquo;</> : "Nothing to narrow by yet"}
                  </p>
                )}

                {/* A search flattens the two levels into one list of answers. */}
                {needle &&
                  hits.departments.map((option) => {
                    const covered = option.unit ? value.units.includes(option.unit.id) : false;
                    const chosen = covered || value.departments.includes(option.id);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={covered}
                        onClick={() => toggle("departments", option.id)}
                        onMouseEnter={() => setHovered(null)}
                        title={covered ? `Covered by ${option.unit?.name}` : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                          covered
                            ? "cursor-default opacity-55"
                            : chosen
                              ? "bg-brand-50/70 hover:bg-brand-50"
                              : "hover:bg-ink-50",
                        )}
                      >
                        <Box checked={chosen} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13px]",
                            chosen ? "font-semibold text-brand-700" : "text-ink-800",
                          )}
                        >
                          {option.name}
                        </span>

                        {/* Which unit it belongs to: the thing that tells two
                            departments of the same name apart. */}
                        {option.unit && (
                          <span className="max-w-24 shrink-0 truncate rounded-full bg-status-progress-bg px-1.5 py-0.5 text-[10px] font-semibold text-status-progress-fg">
                            {option.unit.name}
                          </span>
                        )}
                        <span className="text-[11px] text-ink-400 tabular-nums">{option.count}</span>
                      </button>
                    );
                  })}

                {(needle ? hits.units : shown).map((group) => {
                  const unitPicked = value.units.includes(group.id);
                  const inside = group.departments.filter((item) =>
                    value.departments.includes(item.id),
                  ).length;
                  const active = hovered === group.id;

                  return (
                    <div
                      key={group.id}
                      onMouseEnter={() => setHovered(group.id)}
                      className={cn(
                        "flex items-center gap-1 rounded-lg pr-1 transition-colors",
                        unitPicked
                          ? "bg-brand-50/70 hover:bg-brand-50"
                          : active
                            ? "bg-ink-50"
                            : "hover:bg-ink-50/70",
                      )}
                    >
                      {/* Ticking a unit and looking inside it are different
                          intentions, so the tick box is its own target. */}
                      <button
                        type="button"
                        onClick={() => toggle("units", group.id)}
                        onFocus={() => setHovered(group.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left"
                      >
                        <Box checked={unitPicked} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13px]",
                            unitPicked ? "font-semibold text-brand-700" : "font-medium text-ink-800",
                          )}
                        >
                          {group.name}
                        </span>

                        {/* How many of its departments are ticked, when the
                            unit itself is not. */}
                        {!unitPicked && inside > 0 && (
                          <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white tabular-nums">
                            {inside}
                          </span>
                        )}
                        <span className="text-[11px] text-ink-400 tabular-nums">{group.count}</span>
                      </button>

                      <ChevronRight
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 transition-colors",
                          active ? "text-ink-500" : "text-ink-300",
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {openUnit && (
              <div className="flex w-52 shrink-0 flex-col border-l border-line">
                <p className="border-b border-line px-3 py-2 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
                  {openUnit.name}
                </p>

                <div className="flex-1 overflow-y-auto p-1.5">
                  {openUnit.departments.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[12px] text-ink-400">
                      Nothing in this unit
                    </p>
                  ) : (
                    openUnit.departments.map((option) => {
                      // A ticked unit already covers its departments, so they
                      // read as chosen rather than as another thing to tick.
                      const covered = value.units.includes(openUnit.id);
                      const chosen = covered || value.departments.includes(option.id);

                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={covered}
                          onClick={() => toggle("departments", option.id)}
                          title={covered ? `Covered by ${openUnit.name}` : undefined}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                            covered
                              ? "cursor-default opacity-55"
                              : chosen
                                ? "bg-brand-50/70 hover:bg-brand-50"
                                : "hover:bg-ink-50",
                          )}
                        >
                          <Box checked={chosen} />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-[12.5px]",
                              chosen ? "font-semibold text-brand-700" : "text-ink-700",
                            )}
                          >
                            {option.name}
                          </span>
                          <span className="text-[11px] text-ink-400 tabular-nums">
                            {option.count}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
