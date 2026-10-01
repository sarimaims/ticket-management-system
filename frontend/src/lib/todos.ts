import { api } from "./api";
import type { TicketPriority } from "./types";

/** The colours a column can wear; the board maps each to its own classes. */
export const TODO_COLORS = [
  "slate",
  "blue",
  "amber",
  "green",
  "red",
  "violet",
  "teal",
  "pink",
] as const;

export type TodoColor = (typeof TODO_COLORS)[number];

/** One workspace: SEO, Graphics - a board of its own with its own columns. */
export type TodoBoard = {
  id: string;
  name: string;
  order: number;
  /** The first workspace, "My board": it can be renamed but not deleted. */
  isDefault: boolean;
};

/** Every workspace, left to right. A first visit comes back with "My board". */
export function listBoards(signal?: AbortSignal) {
  return api<{ boards: TodoBoard[] }>("/todos/boards", { signal }).then((data) => data.boards);
}

/** A new workspace opens with To Do, In Progress and Done. */
export function createBoard(name: string) {
  return api<{ board: TodoBoard }>("/todos/boards", { method: "POST", body: { name } }).then(
    (data) => data.board,
  );
}

export function renameBoard(id: string, name: string) {
  return api<{ board: TodoBoard }>(`/todos/boards/${id}`, {
    method: "PATCH",
    body: { name },
  }).then((data) => data.board);
}

/** Goes with every column and to-do in it. */
export function deleteBoard(id: string) {
  return api<{ deletedTodos: number }>(`/todos/boards/${id}`, { method: "DELETE" });
}

/** One column on the board: a status its owner named. */
export type TodoColumn = {
  id: string;
  name: string;
  color: TodoColor;
  order: number;
};

/** One card. Priorities are the same four a ticket uses. */
export type TodoRecord = {
  id: string;
  column: string;
  title: string;
  description: string;
  priority: TicketPriority;
  dueDate: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type TodoInput = {
  title?: string;
  description?: string;
  priority?: TicketPriority;
  /** YYYY-MM-DD, or null to clear it. */
  dueDate?: string | null;
};

/** One workspace. An empty one comes back with three starter columns. */
export function getBoard(board: string, signal?: AbortSignal) {
  return api<{ columns: TodoColumn[]; todos: TodoRecord[] }>(
    `/todos?board=${encodeURIComponent(board)}`,
    { signal },
  );
}

export function createColumn(board: string, input: { name: string; color?: TodoColor }) {
  return api<{ column: TodoColumn }>("/todos/columns", {
    method: "POST",
    body: { ...input, board },
  }).then((data) => data.column);
}

export function updateColumn(id: string, input: { name?: string; color?: TodoColor }) {
  return api<{ column: TodoColumn }>(`/todos/columns/${id}`, {
    method: "PATCH",
    body: input,
  }).then((data) => data.column);
}

/** Its cards move to `moveTo`, or the first remaining column. */
export function deleteColumn(id: string, moveTo?: string) {
  return api<{ movedTo: string; moved: number }>(`/todos/columns/${id}`, {
    method: "DELETE",
    body: moveTo ? { moveTo } : {},
  });
}

/** Every column id of one workspace, left to right. */
export function reorderColumns(board: string, ids: string[]) {
  return api<{ success: true }>("/todos/columns/order", {
    method: "PATCH",
    body: { board, ids },
  });
}

export function createTodo(column: string, input: TodoInput & { title: string }) {
  return api<{ todo: TodoRecord }>("/todos", {
    method: "POST",
    body: { ...input, column },
  }).then((data) => data.todo);
}

export function updateTodo(id: string, input: TodoInput) {
  return api<{ todo: TodoRecord }>(`/todos/${id}`, { method: "PATCH", body: input }).then(
    (data) => data.todo,
  );
}

/** Puts a card at `index` in `column` - the drop of a drag. */
export function moveTodo(id: string, column: string, index: number) {
  return api<{ success: true }>(`/todos/${id}/move`, {
    method: "PATCH",
    body: { column, index },
  });
}

export function deleteTodo(id: string) {
  return api<{ success: true }>(`/todos/${id}`, { method: "DELETE" });
}
