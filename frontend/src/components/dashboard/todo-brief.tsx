"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ListTodo, Plus } from "lucide-react";

import { Card, FooterLink } from "@/components/dashboard/home-widgets";
import { COLOR, EDGE } from "@/components/todos/todo-board";
import { Skeleton } from "@/components/ui/skeleton";
import { getTodoSummary, type TodoBoard, type TodoColumn, type TodoRecord } from "@/lib/todos";
import { cn } from "@/lib/utils";

/** A column whose name says its cards are finished. Done is a column, not a flag. */
const FINISHED = /^(done|completed?|finished|closed)$/i;

/** How often the brief looks again while the dashboard stays open. */
const REFRESH_MS = 60_000;

/** How many of the nearest to-dos the brief lists. */
const UPCOMING = 5;

type Summary = {
  boards: TodoBoard[];
  columns: (TodoColumn & { board: string })[];
  todos: TodoRecord[];
};

/** Today as YYYY-MM-DD in the reader's own clock. */
function dayKey(offset = 0) {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** "3 days late", "Today", "Tomorrow", "Fri 9 Oct" - what a due date means now. */
function dueLabel(due: string, today: string) {
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (days < -1) return { text: `${-days} days late`, tone: "late" as const };
  if (days === -1) return { text: "1 day late", tone: "late" as const };
  if (days === 0) return { text: "Today", tone: "today" as const };
  if (days === 1) return { text: "Tomorrow", tone: "soon" as const };
  const label = new Date(`${due}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return { text: label, tone: days <= 7 ? ("soon" as const) : ("later" as const) };
}

const DUE_TONE = {
  late: "bg-status-overdue-bg text-status-overdue-fg",
  today: "bg-status-waiting-bg text-status-waiting-fg",
  soon: "bg-royal-50 text-royal-700",
  later: "bg-ink-100 text-ink-600",
} as const;

/** One of the three counts: a number big enough to read across the room. */
function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "late" | "today" | "soon";
}) {
  const colour = {
    late: { number: "text-status-overdue-fg", dot: "bg-status-overdue-fg", wash: "bg-status-overdue-bg/50" },
    today: { number: "text-status-waiting-fg", dot: "bg-status-waiting-fg", wash: "bg-status-waiting-bg/55" },
    soon: { number: "text-royal-700", dot: "bg-royal-500", wash: "bg-royal-50" },
  }[tone];

  return (
    <div className={cn("rounded-xl px-3 py-2.5", value > 0 ? colour.wash : "bg-ink-50")}>
      <p
        className={cn(
          "text-[22px] leading-none font-bold tracking-tight tabular-nums",
          value > 0 ? colour.number : "text-ink-300",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 flex items-center gap-1 text-[10.5px] font-medium text-ink-500">
        <span className={cn("size-1.5 rounded-full", value > 0 ? colour.dot : "bg-ink-300")} />
        {label}
      </p>
    </div>
  );
}

/**
 * The reader's own to-do list, in brief: how their cards spread across the
 * columns they made - in those columns' own colours - then how many are late,
 * due today and due this week, and the few whose dates come first.
 *
 * Personal and quiet: nobody else's work is here, and it never shouts. Every
 * line leads to the board itself.
 */
export function TodoBrief() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      getTodoSummary(controller.signal)
        .then((data) => {
          setSummary(data);
          setFailed(false);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setFailed(true);
        });
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  const view = useMemo(() => {
    if (!summary) return null;
    const today = dayKey();
    const weekEnd = dayKey(7);

    const columnById = new Map(summary.columns.map((column) => [column.id, column]));
    const boardById = new Map(summary.boards.map((board) => [board.id, board]));
    const finished = new Set(
      summary.columns.filter((column) => FINISHED.test(column.name.trim())).map((column) => column.id),
    );

    const open = summary.todos.filter((todo) => !finished.has(todo.column));
    const due = (todo: TodoRecord) => todo.dueDate?.slice(0, 10) ?? null;
    const late = open.filter((todo) => (due(todo) ?? "9999") < today);
    const dueToday = open.filter((todo) => due(todo) === today);
    const thisWeek = open.filter((todo) => {
      const at = due(todo);
      return at !== null && at > today && at <= weekEnd;
    });

    // Dated first, nearest first; the late ones lead because they are nearest.
    const upcoming = open
      .filter((todo) => due(todo) !== null)
      .sort((left, right) => (due(left) ?? "").localeCompare(due(right) ?? ""))
      .slice(0, UPCOMING);

    // Where the cards sit, column by column, in board order - the bar and its key.
    const spread = summary.columns
      .map((column) => ({
        column,
        count: summary.todos.filter((todo) => todo.column === column.id).length,
      }))
      .filter((item) => item.count > 0);

    return {
      today,
      total: summary.todos.length,
      open: open.length,
      done: summary.todos.length - open.length,
      late: late.length,
      dueToday: dueToday.length,
      thisWeek: thisWeek.length,
      upcoming,
      spread,
      columnById,
      boardById,
      manyBoards: summary.boards.length > 1,
    };
  }, [summary]);

  const caption = view
    ? view.total === 0
      ? "Your personal list"
      : `${view.open} open · ${view.done} done`
    : "Your personal list";

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-lg bg-linear-to-br from-violet-500 to-indigo-600 text-white shadow-sm">
            <ListTodo className="size-3.5" />
          </span>
          My to-dos
        </span>
      }
      caption={caption}
      action={
        <Link
          href="/todo"
          aria-label="Add a to-do"
          className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-ink-500 transition-colors hover:border-royal-200 hover:bg-royal-50 hover:text-royal-700"
        >
          <Plus className="size-3.5" />
        </Link>
      }
      footer={view && view.total > 0 ? <FooterLink href="/todo">Open my board</FooterLink> : undefined}
    >
      {!view ? (
        failed ? (
          <p className="py-6 text-center text-[11.5px] text-ink-400">Could not load your to-dos.</p>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-2.5 rounded-full" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
            <Skeleton className="h-24 rounded-xl" />
          </div>
        )
      ) : view.total === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="grid size-10 place-items-center rounded-2xl bg-violet-50 text-violet-600">
            <ListTodo className="size-5" />
          </span>
          <p className="text-[13px] font-semibold text-ink-800">Nothing on your list yet</p>
          <p className="max-w-56 text-[11.5px] text-ink-400">
            Jot down what you need to do; the ones with dates show up here first.
          </p>
          <Link
            href="/todo"
            className="mt-1 inline-flex items-center gap-1 rounded-lg bg-ink-900 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-ink-800"
          >
            <Plus className="size-3.5" />
            Add a to-do
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Where the cards sit: one segment per column, in its own colour. */}
          <div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-ink-100">
              {view.spread.map(({ column, count }) => (
                <span
                  key={column.id}
                  title={`${column.name}: ${count}`}
                  className={cn("h-full first:rounded-l-full last:rounded-r-full", COLOR[column.color].dot)}
                  style={{ width: `${(count / view.total) * 100}%` }}
                />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {view.spread.map(({ column, count }) => (
                <li
                  key={column.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 text-[10.5px] font-semibold",
                    COLOR[column.color].pill,
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", COLOR[column.color].dot)} />
                  {column.name}
                  <span className="tabular-nums opacity-70">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Count value={view.late} label="Overdue" tone="late" />
            <Count value={view.dueToday} label="Due today" tone="today" />
            <Count value={view.thisWeek} label="This week" tone="soon" />
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-ink-400 uppercase">
              <CalendarClock className="size-3" />
              Coming up
            </p>
            {view.upcoming.length > 0 ? (
              <ul className="-mx-1.5 space-y-0.5">
                {view.upcoming.map((todo) => {
                  const column = view.columnById.get(todo.column);
                  const board = column ? view.boardById.get(column.board) : undefined;
                  const when = dueLabel(todo.dueDate!.slice(0, 10), view.today);
                  return (
                    <li key={todo.id}>
                      <Link
                        href="/todo"
                        className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-ink-50"
                      >
                        {/* The priority, as the card on the board wears it. */}
                        <span className={cn("h-8 w-1 shrink-0 rounded-full", EDGE[todo.priority])} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-ink-900 group-hover:text-royal-700">
                            {todo.title}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-400">
                            {column && (
                              <span className="inline-flex shrink-0 items-center gap-1">
                                <span className={cn("size-1.5 rounded-full", COLOR[column.color].dot)} />
                                {column.name}
                              </span>
                            )}
                            {view.manyBoards && board && <span className="truncate">· {board.name}</span>}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                            DUE_TONE[when.tone],
                          )}
                        >
                          {when.text}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg bg-ink-50 px-3 py-2.5 text-[11.5px] text-ink-500">
                <CheckCircle2 className="size-3.5 text-status-completed-fg" />
                {view.open === 0 ? "Everything on your list is done." : "No open to-do has a date yet."}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
