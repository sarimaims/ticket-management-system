"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PriorityBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { PriorityPicker } from "@/components/tickets/priority-picker";
import { DateField } from "@/components/tickets/date-field";
import { errorMessage } from "@/lib/api";
import {
  createColumn,
  createTodo,
  deleteColumn,
  deleteTodo,
  getBoard,
  moveTodo,
  reorderColumns,
  TODO_COLORS,
  updateColumn,
  updateTodo,
  type TodoColor,
  type TodoColumn,
  type TodoRecord,
} from "@/lib/todos";
import type { TicketPriority } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

/** Each column colour: the dot by its name, and the strip along its top. */
/**
 * Each column colour: a vivid strip across the top of the lane, the lane's own
 * wash and edge, the badge its name sits in, and the dot. One hue per lane, so
 * a board reads by colour before a single name is read.
 */
export const COLOR: Record<
  TodoColor,
  {
    dot: string;
    bar: string;
    lane: string;
    edge: string;
    pill: string;
    name: string;
    label: string;
  }
> = {
  slate: {
    dot: "bg-slate-400",
    bar: "bg-gradient-to-r from-slate-400 to-slate-500",
    lane: "bg-slate-200/70",
    edge: "border-slate-300/70",
    pill: "bg-slate-300/70 text-slate-800",
    name: "text-slate-700",
    label: "Grey",
  },
  blue: {
    dot: "bg-blue-500",
    bar: "bg-gradient-to-r from-sky-400 to-blue-600",
    lane: "bg-blue-100",
    edge: "border-blue-200",
    pill: "bg-blue-200 text-blue-800",
    name: "text-blue-800",
    label: "Blue",
  },
  amber: {
    dot: "bg-amber-500",
    bar: "bg-gradient-to-r from-amber-400 to-orange-500",
    lane: "bg-amber-100",
    edge: "border-amber-200",
    pill: "bg-amber-200 text-amber-900",
    name: "text-amber-900",
    label: "Amber",
  },
  green: {
    dot: "bg-emerald-500",
    bar: "bg-gradient-to-r from-emerald-400 to-teal-500",
    lane: "bg-emerald-100",
    edge: "border-emerald-200",
    pill: "bg-emerald-200 text-emerald-800",
    name: "text-emerald-800",
    label: "Green",
  },
  red: {
    dot: "bg-red-500",
    bar: "bg-gradient-to-r from-rose-400 to-red-600",
    lane: "bg-red-100",
    edge: "border-red-200",
    pill: "bg-red-200 text-red-800",
    name: "text-red-800",
    label: "Red",
  },
  violet: {
    dot: "bg-violet-500",
    bar: "bg-gradient-to-r from-violet-400 to-indigo-500",
    lane: "bg-violet-100",
    edge: "border-violet-200",
    pill: "bg-violet-200 text-violet-800",
    name: "text-violet-800",
    label: "Violet",
  },
  teal: {
    dot: "bg-teal-500",
    bar: "bg-gradient-to-r from-teal-400 to-cyan-500",
    lane: "bg-teal-100",
    edge: "border-teal-200",
    pill: "bg-teal-200 text-teal-800",
    name: "text-teal-800",
    label: "Teal",
  },
  pink: {
    dot: "bg-pink-500",
    bar: "bg-gradient-to-r from-pink-400 to-fuchsia-500",
    lane: "bg-pink-100",
    edge: "border-pink-200",
    pill: "bg-pink-200 text-pink-800",
    name: "text-pink-800",
    label: "Pink",
  },
};

/** The strip down a card's left edge, in its priority's colour. */
export const EDGE: Record<TicketPriority, string> = {
  Low: "bg-priority-low-dot",
  Medium: "bg-priority-medium-dot",
  High: "bg-priority-high-dot",
  Critical: "bg-priority-critical-dot",
};

/** Today as YYYY-MM-DD where the reader is, so "late" means their today. */
function today() {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What is being dragged. Held in a ref: a drag should not re-render the board. */
type Dragging = { kind: "card"; id: string } | { kind: "column"; id: string } | null;

/** Where a dragged card would land, drawn as a line between cards. */
type CardTarget = { column: string; index: number } | null;

/**
 * Cards in a column, top to bottom. Kept as plain arrays of ids, so a move is
 * a splice and the order the server is told is exactly the order on screen.
 */
function group(columns: TodoColumn[], todos: TodoRecord[]) {
  const out = new Map<string, TodoRecord[]>(columns.map((column) => [column.id, []]));
  for (const todo of [...todos].sort((a, b) => a.order - b.order)) {
    out.get(todo.column)?.push(todo);
  }
  return out;
}

/**
 * A person's own to-do board, the way Jira lays one out: columns they name
 * themselves - the statuses - and cards dragged between them.
 *
 * Every change shows at once and is sent behind it. If the server refuses one,
 * the board is reloaded from the server rather than guessed back into shape.
 */
export function TodoBoard({
  boardId,
  tabs,
}: {
  /** The workspace on screen. The board is remounted when it changes. */
  boardId: string;
  /** The workspace tabs, drawn above the columns. */
  tabs?: React.ReactNode;
}) {
  const toast = useToast();
  const [columns, setColumns] = useState<TodoColumn[]>([]);
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<TodoRecord | null>(null);
  const [removingColumn, setRemovingColumn] = useState<TodoColumn | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  /** The column a new to-do is being written for, while its dialog is open. */
  const [creatingIn, setCreatingIn] = useState<string | null>(null);

  const dragging = useRef<Dragging>(null);
  const [cardTarget, setCardTarget] = useState<CardTarget>(null);
  const [columnTarget, setColumnTarget] = useState<number | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const reload = async (signal?: AbortSignal) => {
    try {
      const board = await getBoard(boardId, signal);
      const sorted = [...board.columns].sort((a, b) => a.order - b.order);
      setColumns(sorted);
      setTodos(board.todos);
      setError("");

      // Arrived from the quick pencil (`?new=1`): open a new to-do in the
      // first column, then drop the flag so a reload does not open it again.
      if (new URLSearchParams(window.location.search).get("new") && sorted[0]) {
        setCreatingIn(sorted[0].id);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(errorMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading the board from the API
    void reload(controller.signal);
    return () => controller.abort();
    // Once per mount: the board is keyed by its workspace, so a switch remounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A write failed: say so, and put the board back the way the server has it. */
  const failed = (title: string, caught: unknown) => {
    toast.error(title, errorMessage(caught));
    void reload();
  };

  const byColumn = useMemo(() => group(columns, todos), [columns, todos]);

  /* ---------------------------------------------------------------- cards */

  const addCard = async (column: string, input: Parameters<typeof createTodo>[1]) => {
    try {
      const todo = await createTodo(column, input);
      // New cards go on top, as the server put them.
      setTodos((current) => [
        todo,
        ...current.map((item) =>
          item.column === column ? { ...item, order: item.order + 1 } : item,
        ),
      ]);
      setCreatingIn(null);
    } catch (caught) {
      failed("Could not add the to-do", caught);
    }
  };

  /** Saves the fields, then - if its status changed - moves it to the top of the new column. */
  const saveCard = async (id: string, input: Parameters<typeof updateTodo>[1], column: string) => {
    try {
      const saved = await updateTodo(id, input);
      if (saved.column !== column) {
        await moveTodo(id, column, 0);
        await reload();
      } else {
        setTodos((current) => current.map((item) => (item.id === id ? saved : item)));
      }
      setEditing(null);
    } catch (caught) {
      toast.error("Could not save the to-do", errorMessage(caught));
    }
  };

  const removeCard = async (todo: TodoRecord) => {
    setTodos((current) => current.filter((item) => item.id !== todo.id));
    setEditing(null);
    try {
      await deleteTodo(todo.id);
      toast.success("To-do deleted", todo.title);
    } catch (caught) {
      failed("Could not delete the to-do", caught);
    }
  };

  /** The drop: shown at once, then sent. */
  const dropCard = (id: string, column: string, index: number) => {
    const card = todos.find((item) => item.id === id);
    if (!card) return;

    const target = (byColumn.get(column) ?? []).filter((item) => item.id !== id);
    const at = Math.max(0, Math.min(index, target.length));
    // Dropped back where it was: nothing to send.
    const before = byColumn.get(card.column) ?? [];
    if (card.column === column && before.findIndex((item) => item.id === id) === at) return;

    target.splice(at, 0, { ...card, column });
    const orders = new Map<string, { column: string; order: number }>();
    target.forEach((item, order) => orders.set(item.id, { column, order }));
    if (card.column !== column) {
      before
        .filter((item) => item.id !== id)
        .forEach((item, order) => orders.set(item.id, { column: card.column, order }));
    }

    setTodos((current) =>
      current.map((item) => {
        const next = orders.get(item.id);
        return next ? { ...item, ...next } : item;
      }),
    );
    moveTodo(id, column, at).catch((caught) => failed("Could not move the to-do", caught));
  };

  /* -------------------------------------------------------------- columns */

  const addColumn = async (name: string, color: TodoColor) => {
    try {
      const column = await createColumn(boardId, { name, color });
      setColumns((current) => [...current, column]);
      setAddingColumn(false);
    } catch (caught) {
      toast.error("Could not add the column", errorMessage(caught));
    }
  };

  const changeColumn = async (id: string, input: { name?: string; color?: TodoColor }) => {
    setColumns((current) => current.map((item) => (item.id === id ? { ...item, ...input } : item)));
    try {
      await updateColumn(id, input);
    } catch (caught) {
      failed("Could not update the column", caught);
    }
  };

  const removeColumn = async (column: TodoColumn, moveTo: string) => {
    setRemovingColumn(null);
    try {
      const result = await deleteColumn(column.id, moveTo);
      await reload();
      toast.success(
        `"${column.name}" removed`,
        result.moved > 0
          ? `${result.moved} to-do${result.moved === 1 ? "" : "s"} moved to "${
              columns.find((item) => item.id === result.movedTo)?.name ?? "another column"
            }"`
          : undefined,
      );
    } catch (caught) {
      failed("Could not remove the column", caught);
    }
  };

  const dropColumn = (id: string, index: number) => {
    const from = columns.findIndex((item) => item.id === id);
    if (from < 0) return;
    const next = columns.filter((item) => item.id !== id);
    // Dropping to the right of itself: the slot it left shifts the index by one.
    const at = Math.max(0, Math.min(index > from ? index - 1 : index, next.length));
    if (at === from) return;
    next.splice(at, 0, columns[from]);
    setColumns(next.map((item, order) => ({ ...item, order })));
    reorderColumns(
      boardId,
      next.map((item) => item.id),
    ).catch((caught) => failed("Could not reorder the columns", caught));
  };

  /* ---------------------------------------------------------------- drag */

  const endDrag = () => {
    dragging.current = null;
    setDraggedId(null);
    setCardTarget(null);
    setColumnTarget(null);
  };

  /** Which slot between the cards of a column the pointer is over. */
  const slotIn = (list: HTMLElement, y: number) => {
    const cards = [...list.querySelectorAll<HTMLElement>("[data-card]")].filter(
      (card) => card.dataset.card !== dragging.current?.id,
    );
    const index = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return index === -1 ? cards.length : index;
  };

  /** Which gap between columns the pointer is over. */
  const gapIn = (board: HTMLElement, x: number) => {
    const lanes = [...board.querySelectorAll<HTMLElement>("[data-column]")];
    const index = lanes.findIndex((lane) => {
      const rect = lane.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    return index === -1 ? lanes.length : index;
  };

  const today_ = today();

  // The page's one action lives in the top bar, beside the trail - there from
  // the first paint, not only once the board has loaded.
  const header = (
    <PageHeader
      title="To-do"
      crumbs={[{ label: "Home", href: "/dashboard" }, { label: "To-do" }]}
      actions={
        <Button size="sm" onClick={() => setAddingColumn(true)}>
          <Plus className="size-3.5" />
          Add column
        </Button>
      }
    />
  );

  if (loading) {
    return (
      <>
        {header}
        {tabs}
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-72 w-72 shrink-0 animate-pulse rounded-xl bg-ink-100" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {tabs}
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {header}

      <div
        // Tall enough that a short column still has room for its options menu:
        // a sideways-scrolling row clips anything that pokes out below it.
        // The board sits on a dotted grid, the way a canvas does: the columns read
        // as things placed on a surface rather than boxes in a page.
        className="flex min-h-[18rem] items-stretch gap-3 overflow-x-auto rounded-2xl border border-line/70 bg-ink-50/60 bg-[radial-gradient(circle,rgba(15,23,42,0.13)_1px,transparent_1.2px)] [background-size:18px_18px] p-3"
        onDragOver={(event) => {
          if (dragging.current?.kind !== "column") return;
          event.preventDefault();
          setColumnTarget(gapIn(event.currentTarget, event.clientX));
        }}
        onDrop={(event) => {
          const drag = dragging.current;
          if (drag?.kind !== "column") return;
          event.preventDefault();
          dropColumn(drag.id, gapIn(event.currentTarget, event.clientX));
          endDrag();
        }}
      >
        {columns.map((column, columnIndex) => {
          const cards = byColumn.get(column.id) ?? [];
          return (
            <div key={column.id} className="relative flex max-w-80 min-w-60 flex-1 basis-0">
              {columnTarget === columnIndex && (
                <span className="absolute inset-y-0 -left-2 w-1 rounded-full bg-brand-500" />
              )}
              <Lane
                column={column}
                count={cards.length}
                dragged={draggedId === column.id}
                onRename={(name) => void changeColumn(column.id, { name })}
                onColor={(color) => void changeColumn(column.id, { color })}
                onRemove={() =>
                  columns.length > 1
                    ? setRemovingColumn(column)
                    : toast.error("A board needs at least one column")
                }
                onAdd={() => setCreatingIn(column.id)}
                onDragStart={() => {
                  dragging.current = { kind: "column", id: column.id };
                  setDraggedId(column.id);
                }}
                onDragEnd={endDrag}
              >
                <ul
                  className="flex min-h-16 flex-1 flex-col gap-2.5"
                  onDragOver={(event) => {
                    if (dragging.current?.kind !== "card") return;
                    event.preventDefault();
                    event.stopPropagation();
                    const index = slotIn(event.currentTarget, event.clientY);
                    setCardTarget((current) =>
                      current?.column === column.id && current.index === index
                        ? current
                        : { column: column.id, index },
                    );
                  }}
                  onDrop={(event) => {
                    const drag = dragging.current;
                    if (drag?.kind !== "card") return;
                    event.preventDefault();
                    event.stopPropagation();
                    dropCard(drag.id, column.id, slotIn(event.currentTarget, event.clientY));
                    endDrag();
                  }}
                >
                  {cards
                    .filter((card) => card.id !== draggedId)
                    .map((card, index) => (
                      <li key={card.id} className="relative">
                        {cardTarget?.column === column.id && cardTarget.index === index && (
                          <DropLine />
                        )}
                        <Card
                          todo={card}
                          late={Boolean(card.dueDate && card.dueDate.slice(0, 10) < today_)}
                          onOpen={() => setEditing(card)}
                          onDragStart={() => {
                            dragging.current = { kind: "card", id: card.id };
                            // After the browser has taken its drag image, so the
                            // ghost is the card rather than an empty slot.
                            requestAnimationFrame(() => setDraggedId(card.id));
                          }}
                          onDragEnd={endDrag}
                        />
                      </li>
                    ))}
                  {cards.length === 0 && cardTarget?.column !== column.id && (
                    <li className="grid flex-1 place-items-center px-3 py-8 text-center text-[12px] text-ink-400">
                      <span>
                        Nothing here yet.
                        <br />
                        Drop a card here, or add one below.
                      </span>
                    </li>
                  )}
                  {cardTarget?.column === column.id &&
                    cardTarget.index >= cards.filter((card) => card.id !== draggedId).length && (
                      <li className="relative h-1">
                        <DropLine />
                      </li>
                    )}
                </ul>
              </Lane>
            </div>
          );
        })}
        {columnTarget === columns.length && (
          <span className="h-40 w-1 shrink-0 self-stretch rounded-full bg-brand-500" />
        )}
      </div>

      <CardEditor
        todo={editing}
        creatingIn={creatingIn}
        onCreate={(column, input) => void addCard(column, input)}
        columns={columns}
        onClose={() => {
          setEditing(null);
          setCreatingIn(null);
        }}
        onSave={(id, input, column) => void saveCard(id, input, column)}
        onDelete={(todo) => void removeCard(todo)}
      />

      <ColumnCreator
        open={addingColumn}
        onClose={() => setAddingColumn(false)}
        onCreate={(name, color) => void addColumn(name, color)}
      />

      <RemoveColumnModal
        column={removingColumn}
        columns={columns}
        count={removingColumn ? (byColumn.get(removingColumn.id) ?? []).length : 0}
        onClose={() => setRemovingColumn(null)}
        onConfirm={(column, moveTo) => void removeColumn(column, moveTo)}
      />
    </>
  );
}

/** Where a dragged card would land. */
function DropLine() {
  return <span className="absolute -top-1.5 right-0 left-0 h-1 rounded-full bg-brand-500" />;
}

/* ------------------------------------------------------------------ lane */

function Lane({
  column,
  count,
  dragged,
  onRename,
  onColor,
  onRemove,
  onAdd,
  onDragStart,
  onDragEnd,
  children,
}: {
  column: TodoColumn;
  count: number;
  dragged: boolean;
  onRename: (name: string) => void;
  onColor: (color: TodoColor) => void;
  onRemove: () => void;
  /** Opens the to-do dialog for a new card in this column. */
  onAdd: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: React.ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A click anywhere else puts the menu away.
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const commitName = () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== column.name) onRename(next);
    else setName(column.name);
  };

  return (
    <section
      data-column={column.id}
      className={cn(
        "relative flex h-[calc(100dvh-8.75rem)] min-h-[18rem] w-full flex-col rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-opacity",
        COLOR[column.color].lane,
        COLOR[column.color].edge,
        dragged && "opacity-40",
      )}
    >
      <span
        className={cn("absolute inset-x-0 top-0 h-1 rounded-t-2xl", COLOR[column.color].bar)}
        aria-hidden="true"
      />
      <header className="flex items-center gap-1.5 px-3 pt-3.5 pb-2">
        <span
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", column.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          title="Drag to reorder columns"
          className="grid size-5 shrink-0 cursor-grab place-items-center rounded text-ink-300 hover:bg-white/70 hover:text-ink-500 active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </span>
        {renaming ? (
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitName();
              if (event.key === "Escape") {
                setName(column.name);
                setRenaming(false);
              }
            }}
            aria-label="Column name"
            className="h-6 min-w-0 flex-1 rounded border border-brand-400 bg-surface px-1.5 text-[12px] font-bold text-ink-900 uppercase focus:outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1">
            <button
              type="button"
              onDoubleClick={() => setRenaming(true)}
              title="Double-click to rename"
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold tracking-wide uppercase",
                COLOR[column.color].pill,
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", COLOR[column.color].dot)} />
              <span className="truncate">{column.name}</span>
            </button>
          </span>
        )}

        <span
          className={cn(
            "grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-white px-1.5 text-[11px] font-bold text-ink-500 tabular-nums ring-1 ring-ink-200",
          )}
        >
          {count}
        </span>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenu((current) => !current)}
            aria-label={`Options for ${column.name}`}
            aria-expanded={menu}
            className="grid size-6 place-items-center rounded-md text-ink-400 hover:bg-white/80 hover:text-ink-700"
          >
            <MoreHorizontal className="size-4" />
          </button>

          {menu && (
            <div
              role="menu"
              className="absolute top-7 right-0 z-30 w-48 rounded-lg border border-line bg-surface p-1 shadow-xl shadow-ink-900/10"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setRenaming(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-700 hover:bg-ink-50"
              >
                <Pencil className="size-3.5 text-ink-400" />
                Rename
              </button>

              <p className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-ink-400 uppercase">
                Colour
              </p>
              <div className="grid grid-cols-8 gap-1 px-2 pb-1.5">
                {TODO_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onColor(color)}
                    aria-label={COLOR[color].label}
                    title={COLOR[color].label}
                    className={cn(
                      "grid size-4 place-items-center rounded-full",
                      COLOR[color].dot,
                      column.color === color && "ring-2 ring-ink-900/30 ring-offset-1",
                    )}
                  >
                    {column.color === color && (
                      <Check className="size-2.5 text-white" strokeWidth={3} />
                    )}
                  </button>
                ))}
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onRemove();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-brand-700 hover:bg-brand-50"
              >
                <Trash2 className="size-3.5" />
                Delete column
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5">{children}</div>

      <div className="px-2.5 pb-2.5">
        {/* The same dialog a card opens with, so a new to-do can be given
            everything at once rather than a title now and the rest later. */}
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-ink-500 transition-colors hover:text-brand-600"
        >
          <Plus className="size-3.5" />
          Add a to-do
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ card */

function Card({
  todo,
  late,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  todo: TodoRecord;
  late: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      data-card={todo.id}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", todo.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "relative block w-full cursor-grab overflow-hidden rounded-xl bg-white py-2.5 pr-3 pl-4 text-left",
        "shadow-[0_1px_2px_rgba(15,23,42,0.05),0_2px_6px_rgba(15,23,42,0.06)] ring-1 ring-ink-900/5",
        "transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.10)] active:cursor-grabbing",
      )}
    >
      <span
        className={cn("absolute inset-y-2 left-1.5 w-1 rounded-full", EDGE[todo.priority])}
        aria-hidden="true"
      />
      <p className="text-[13px] leading-snug font-semibold break-words text-ink-900">
        {todo.title}
      </p>
      {todo.description && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-500">
          {todo.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={todo.priority} className="px-1.5 py-0.5 text-[10px]" />
        {todo.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
              late ? "bg-status-overdue-bg text-status-overdue-fg" : "bg-ink-100 text-ink-600",
            )}
          >
            <CalendarDays className="size-3" />
            {formatDate(todo.dueDate.slice(0, 10))}
          </span>
        )}
      </div>
    </button>
  );
}

/* --------------------------------------------------------------- dialogs */

function CardEditor({
  todo,
  creatingIn,
  columns,
  onClose,
  onSave,
  onCreate,
  onDelete,
}: {
  todo: TodoRecord | null;
  /** Set instead of `todo` when writing a new card, to the column it starts in. */
  creatingIn: string | null;
  columns: TodoColumn[];
  onClose: () => void;
  onCreate: (
    column: string,
    input: { title: string; description: string; priority: TicketPriority; dueDate: string | null },
  ) => void;
  onSave: (
    id: string,
    input: { title: string; description: string; priority: TicketPriority; dueDate: string | null },
    column: string,
  ) => void;
  onDelete: (todo: TodoRecord) => void;
}) {
  return (
    <Modal
      open={todo !== null || creatingIn !== null}
      onClose={onClose}
      title={todo ? "To-do" : "New to-do"}
      className="max-w-lg"
    >
      {/* Keyed so each card - or each new one - opens with its own values. */}
      {(todo || creatingIn) && (
        <CardForm
          key={todo?.id ?? `new-${creatingIn}`}
          todo={todo}
          startColumn={todo?.column ?? creatingIn ?? columns[0]?.id ?? ""}
          columns={columns}
          onClose={onClose}
          onSave={onSave}
          onCreate={onCreate}
          onDelete={onDelete}
        />
      )}
    </Modal>
  );
}

function CardForm({
  todo,
  startColumn,
  columns,
  onClose,
  onSave,
  onCreate,
  onDelete,
}: {
  /** Null when this is a new to-do. */
  todo: TodoRecord | null;
  startColumn: string;
  columns: TodoColumn[];
  onClose: () => void;
  onSave: Parameters<typeof CardEditor>[0]["onSave"];
  onCreate: Parameters<typeof CardEditor>[0]["onCreate"];
  onDelete: (todo: TodoRecord) => void;
}) {
  const [title, setTitle] = useState(todo?.title ?? "");
  const [description, setDescription] = useState(todo?.description ?? "");
  const [priority, setPriority] = useState<TicketPriority>(todo?.priority ?? "Medium");
  const [dueDate, setDueDate] = useState(todo?.dueDate ? todo.dueDate.slice(0, 10) : "");
  const [column, setColumn] = useState(startColumn);
  // A new one starts blank, so the box is not flagged before anything was typed.
  const [touched, setTouched] = useState(Boolean(todo));
  const [confirming, setConfirming] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) {
          setTouched(true);
          return;
        }
        const input = {
          title: title.trim(),
          description: description.trim(),
          priority,
          dueDate: dueDate || null,
        };
        if (todo) onSave(todo.id, input, column);
        else onCreate(column, input);
      }}
    >
      <Field label="Title" required htmlFor="todo-title">
        <Input
          id="todo-title"
          value={title}
          maxLength={200}
          autoFocus={!todo}
          placeholder="What needs doing?"
          invalid={touched && !title.trim()}
          onChange={(event) => {
            setTitle(event.target.value);
            setTouched(true);
          }}
        />
      </Field>

      <Field label="Description" htmlFor="todo-description">
        <Textarea
          id="todo-description"
          value={description}
          maxLength={2000}
          placeholder="Notes, links, anything that helps"
          onChange={(event) => setDescription(event.target.value)}
          className="min-h-24"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Status" htmlFor="todo-column">
          <Select
            id="todo-column"
            className="h-8"
            value={column}
            onChange={(event) => setColumn(event.target.value)}
          >
            {columns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="todo-priority">
          <PriorityPicker id="todo-priority" value={priority} onChange={setPriority} />
        </Field>
        <Field label="Due date" htmlFor="todo-due">
          <DateField
            id="todo-due"
            value={dueDate}
            onChange={setDueDate}
            placeholder="None"
            className="gap-2 px-2.5 [&>span]:text-[13px]"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        {!todo ? (
          <span />
        ) : confirming ? (
          <span className="flex items-center gap-2 text-[12px] text-ink-600">
            Delete this to-do?
            <Button type="button" size="sm" onClick={() => onDelete(todo)}>
              Delete
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        )}
        <span className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim()}>
            {todo ? "Save" : "Add to-do"}
          </Button>
        </span>
      </div>
    </form>
  );
}

function ColumnCreator({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, color: TodoColor) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<TodoColor>("blue");

  const close = () => {
    setName("");
    setColor("blue");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a column"
      description="A column is a status on your board: Backlog, Review, Blocked - whatever your work moves through."
      className="max-w-md"
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onCreate(name.trim(), color);
          setName("");
        }}
      >
        <Field label="Name" required htmlFor="column-name">
          <Input
            id="column-name"
            autoFocus
            value={name}
            maxLength={40}
            placeholder="e.g. Review"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-ink-800">Colour</p>
          <div className="flex flex-wrap gap-2">
            {TODO_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setColor(item)}
                aria-label={COLOR[item].label}
                aria-pressed={color === item}
                title={COLOR[item].label}
                className={cn(
                  "grid size-6 place-items-center rounded-full",
                  COLOR[item].dot,
                  color === item && "ring-2 ring-ink-900/30 ring-offset-2",
                )}
              >
                {color === item && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" size="sm" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Add column
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveColumnModal({
  column,
  columns,
  count,
  onClose,
  onConfirm,
}: {
  column: TodoColumn | null;
  columns: TodoColumn[];
  count: number;
  onClose: () => void;
  onConfirm: (column: TodoColumn, moveTo: string) => void;
}) {
  const others = columns.filter((item) => item.id !== column?.id);
  const [moveTo, setMoveTo] = useState("");
  const target = others.find((item) => item.id === moveTo) ?? others[0];

  return (
    <Modal
      open={column !== null}
      onClose={onClose}
      title={`Delete "${column?.name ?? ""}"?`}
      description={
        count > 0 ? "Its to-dos are kept and moved to another column." : "This column is empty."
      }
      className="max-w-md"
    >
      {count > 0 && (
        <Field label={`Move its ${count} to-do${count === 1 ? "" : "s"} to`} htmlFor="move-to">
          <Select
            id="move-to"
            className="h-8"
            value={target?.id ?? ""}
            onChange={(event) => setMoveTo(event.target.value)}
          >
            {others.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!target}
          onClick={() => {
            if (column && target) onConfirm(column, target.id);
            setMoveTo("");
          }}
        >
          Delete column
        </Button>
      </div>
    </Modal>
  );
}
