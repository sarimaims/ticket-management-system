"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, LayoutGrid, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TodoBoard } from "@/components/todos/todo-board";
import { errorMessage } from "@/lib/api";
import {
  createBoard,
  deleteBoard,
  listBoards,
  renameBoard,
  type TodoBoard as Workspace,
} from "@/lib/todos";
import { cn } from "@/lib/utils";

/** Which workspace was open last, so the page comes back to it. Per browser. */
const LAST_KEY = "flowdesk:todo-board";

function rememberedBoard() {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function rememberBoard(id: string) {
  try {
    window.localStorage.setItem(LAST_KEY, id);
  } catch {
    // Private windows and blocked storage just start on the first workspace.
  }
}

/**
 * The to-do page: separate workspaces - SEO, Graphics, whatever is kept apart -
 * each a board with its own columns and cards. The tabs switch between them,
 * and the board below is remounted for each, so nothing from one leaks into
 * the next.
 */
export function TodoWorkspaces() {
  const toast = useToast();
  const [boards, setBoards] = useState<Workspace[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState("");

  /** The dialog for a name: a new workspace, or renaming one. */
  const [naming, setNaming] = useState<{ board: Workspace | null } | null>(null);
  const [removing, setRemoving] = useState<Workspace | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listBoards(controller.signal)
      .then((list) => {
        setBoards(list);
        const last = rememberedBoard();
        setActive(list.find((board) => board.id === last)?.id ?? list[0]?.id ?? null);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      });
    return () => controller.abort();
  }, []);

  const open = (id: string) => {
    setActive(id);
    rememberBoard(id);
  };

  const saveName = async (name: string) => {
    const board = naming?.board;
    setNaming(null);
    try {
      if (board) {
        const saved = await renameBoard(board.id, name);
        setBoards((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      } else {
        const created = await createBoard(name);
        setBoards((current) => [...current, created]);
        open(created.id);
        toast.success(`"${created.name}" created`, "It starts with To Do, In Progress and Done.");
      }
    } catch (caught) {
      toast.error(
        board ? "Could not rename the workspace" : "Could not create the workspace",
        errorMessage(caught),
      );
    }
  };

  const remove = async (board: Workspace) => {
    setRemoving(null);
    try {
      const result = await deleteBoard(board.id);
      const rest = boards.filter((item) => item.id !== board.id);
      setBoards(rest);
      if (active === board.id && rest[0]) open(rest[0].id);
      toast.success(
        `"${board.name}" deleted`,
        result.deletedTodos > 0
          ? `${result.deletedTodos} to-do${result.deletedTodos === 1 ? "" : "s"} went with it.`
          : undefined,
      );
    } catch (caught) {
      toast.error("Could not delete the workspace", errorMessage(caught));
    }
  };

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {error}
      </div>
    );
  }

  const tabs = (
    <nav
      aria-label="Workspaces"
      className="-mt-2 mb-1.5 flex items-center gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {boards.map((board, index) => (
        <Tab
          key={board.id}
          board={board}
          active={board.id === active}
          // A server from before the flag sends none; the first tab is the default then.
          canDelete={!(board.isDefault ?? index === 0)}
          onOpen={() => open(board.id)}
          onRename={() => setNaming({ board })}
          onDelete={() => setRemoving(board)}
        />
      ))}
      <button
        type="button"
        onClick={() => setNaming({ board: null })}
        className="ml-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[13px] font-semibold whitespace-nowrap text-ink-500 transition-colors hover:text-brand-600"
      >
        <Plus className="size-3.5" />
        New workspace
      </button>
    </nav>
  );

  return (
    <>
      {active ? (
        <TodoBoard key={active} boardId={active} tabs={tabs} />
      ) : (
        <>
          {tabs}
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-72 w-72 shrink-0 animate-pulse rounded-xl bg-ink-100" />
            ))}
          </div>
        </>
      )}

      <NameModal
        open={naming !== null}
        board={naming?.board ?? null}
        onClose={() => setNaming(null)}
        onSave={(name) => void saveName(name)}
      />

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Delete "${removing?.name ?? ""}"?`}
        description="Every column and to-do in this workspace is deleted with it. This cannot be undone."
        className="max-w-md"
      >
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(null)}>
            Keep it
          </Button>
          <Button type="button" size="sm" onClick={() => removing && void remove(removing)}>
            Delete workspace
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * One workspace tab, with its options behind three dots.
 *
 * The menu is drawn on the body and pinned under its button: the tab row
 * scrolls sideways, and a menu left inside it was clipped by that same box.
 */
function Tab({
  board,
  active,
  canDelete,
  onOpen,
  onRename,
  onDelete,
}: {
  board: Workspace;
  active: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  /** Where the open menu is pinned, in viewport coordinates; null while shut. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (at) {
      setAt(null);
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setAt({ left: rect.left, top: rect.bottom + 4 });
  };

  // A press elsewhere, a scroll or a resize puts it away: it is pinned to a
  // spot on screen, and that spot is only right while nothing moves.
  useEffect(() => {
    if (!at) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) setAt(null);
    };
    const close = () => setAt(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAt(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]";

  return (
    <div
      className={cn(
        "group relative -mb-px flex shrink-0 items-center border-b-2 pr-1 transition-colors",
        active ? "border-brand-600" : "border-transparent hover:border-ink-300",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={onRename}
        aria-current={active ? "page" : undefined}
        title="Double-click to rename"
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 py-1.5 pr-1 pl-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
          active ? "text-brand-700" : "text-ink-500 hover:text-ink-800",
        )}
      >
        <LayoutGrid className={cn("size-3.5", active ? "text-brand-600" : "text-ink-400")} />
        {board.name}
      </button>

      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        aria-label={`Options for ${board.name}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        className={cn(
          "grid size-6 cursor-pointer place-items-center rounded-md text-ink-400 transition-opacity hover:bg-ink-100 hover:text-ink-700",
          active || at
            ? "opacity-100"
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {at &&
        createPortal(
          <div
            ref={list}
            role="menu"
            style={{ left: at.left, top: at.top }}
            className="fixed z-50 w-44 rounded-lg border border-line bg-surface p-1 shadow-xl shadow-ink-900/10"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAt(null);
                onRename();
              }}
              className={cn(item, "text-ink-700 hover:bg-ink-50")}
            >
              <Pencil className="size-3.5 text-ink-400" />
              Rename
            </button>
            {/* The default workspace is always there to open on: no delete. */}
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAt(null);
                  onDelete();
                }}
                className={cn(item, "text-brand-700 hover:bg-brand-50")}
              >
                <Trash2 className="size-3.5" />
                Delete workspace
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Names a new workspace, or renames one. */
function NameModal({
  open,
  board,
  onClose,
  onSave,
}: {
  open: boolean;
  board: Workspace | null;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={board ? "Rename workspace" : "New workspace"}
      description={
        board
          ? undefined
          : "A separate board with its own columns - SEO, Graphics, anything you keep apart."
      }
      className="max-w-md"
    >
      {/* Keyed so each opening starts from the right name. */}
      {open && (
        <NameForm key={board?.id ?? "new"} board={board} onClose={onClose} onSave={onSave} />
      )}
    </Modal>
  );
}

function NameForm({
  board,
  onClose,
  onSave,
}: {
  board: Workspace | null;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(board?.name ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <Field label="Name" required htmlFor="workspace-name">
        <Input
          id="workspace-name"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="e.g. SEO"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          {board ? "Save" : "Create workspace"}
        </Button>
      </div>
    </form>
  );
}
