import { api } from "./api";
import type { DepartmentRole, Role } from "./auth";
import type { LibraryItem } from "./library";
import type { TicketRecord } from "./tickets";
import type { TicketPriority, TicketStatus } from "./types";

/* ------------------------------------------------------------------ results */

export type SearchTicket = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  requestType: string;
  description: string;
  departments: { id: string; name: string; unit: string }[];
  raisedBy: { id: string; name: string };
  assignees: { id: string; name: string }[];
  deadline: string | null;
  attachmentCount: number;
  messageCount: number;
  lastMessageAt: string | null;
  escalated: boolean;
  createdAt: string;
  updatedAt: string;
  /** Why it matched, when the subject alone does not show it. */
  match: { field: "conversation" | "description" | "attachment"; text: string } | null;
};

export type SearchPerson = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: "active" | "invited" | "suspended";
  designation: string;
  departments: {
    id: string;
    name: string;
    unit: string;
    role: DepartmentRole;
    designation: string;
  }[];
};

export type SearchDepartment = {
  id: string;
  name: string;
  description: string;
  unit: { id: string; name: string } | null;
  isActive: boolean;
  members: number;
  heads: number;
  myRole: DepartmentRole | null;
  /** A member, or a manager: its page opens. Anyone else can only raise to it. */
  canOpen: boolean;
};

export type SearchUnit = { id: string; name: string; description: string; departments: number };

export type SearchMessage = {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
  ticket: { id: string; number: string; subject: string; status: TicketStatus };
};

type Section<T> = { items: T[]; more: boolean };

export type SearchResults = {
  tickets: Section<SearchTicket>;
  people: Section<SearchPerson>;
  departments: Section<SearchDepartment>;
  units: Section<SearchUnit>;
  messages: Section<SearchMessage>;
  /** Photos, videos, documents and links from the tickets in reach - shaped as the library's. */
  files: Section<LibraryItem>;
};

export const NO_RESULTS: SearchResults = {
  tickets: { items: [], more: false },
  people: { items: [], more: false },
  departments: { items: [], more: false },
  units: { items: [], more: false },
  messages: { items: [], more: false },
  files: { items: [], more: false },
};

/* ------------------------------------------------------------------ the query */

/** The filters a query can carry, as `key:value` words in the box. */
export type FilterKey = "status" | "priority" | "dept" | "from" | "to" | "is" | "has";

/** Every spelling a filter answers to. The first is the one written back. */
const KEY_ALIASES: Record<string, FilterKey> = {
  status: "status",
  s: "status",
  priority: "priority",
  p: "priority",
  dept: "dept",
  department: "dept",
  d: "dept",
  from: "from",
  by: "from",
  raiser: "from",
  to: "to",
  assignee: "to",
  assigned: "to",
  is: "is",
  has: "has",
};

/** What each filter can be, for the suggestions under the box. */
export const FILTER_VALUES: Record<FilterKey, { value: string; label: string }[]> = {
  status: [
    { value: "open", label: "Open - anything not finished" },
    { value: "new", label: "Not started" },
    { value: "progress", label: "In progress" },
    { value: "approval", label: "Awaiting approval" },
    { value: "overdue", label: "Overdue" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
  priority: [
    { value: "urgent", label: "Urgent - high or critical" },
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ],
  is: [
    { value: "mine", label: "Raised by me" },
    { value: "assigned", label: "Assigned to me" },
    { value: "today", label: "Due today" },
    { value: "overdue", label: "Overdue" },
    { value: "approval", label: "Awaiting approval" },
    { value: "unassigned", label: "Not picked up" },
    { value: "urgent", label: "Urgent" },
    { value: "shared", label: "Shared by several departments" },
    { value: "escalated", label: "Escalated" },
  ],
  has: [
    { value: "files", label: "Has attachments" },
    { value: "replies", label: "Has a conversation" },
    { value: "date", label: "Has a due date" },
  ],
  // Free text: a department, or a person's name.
  dept: [],
  from: [],
  to: [],
};

/** What each filter is, for the tips and the chips. */
export const FILTER_HELP: { key: FilterKey; example: string; label: string }[] = [
  { key: "status", example: "status:overdue", label: "By status" },
  { key: "priority", example: "priority:urgent", label: "By priority" },
  { key: "is", example: "is:mine", label: "Mine, assigned, due today…" },
  { key: "dept", example: "dept:finance", label: "In a department" },
  { key: "from", example: "from:kuldeep", label: "Raised by someone" },
  { key: "to", example: "to:melvin", label: "Assigned to someone" },
  { key: "has", example: "has:files", label: "With files or replies" },
];

export type QueryChip = { key: FilterKey; value: string; raw: string };

export type ParsedQuery = {
  /** The words left once the filters are taken out. */
  text: string;
  words: string[];
  chips: QueryChip[];
  /** `key:` with the value still being typed, for the suggestions. */
  partial: { key: FilterKey; value: string } | null;
  /** Typed with a leading ">": the actions list, as in a command palette. */
  actions: boolean;
  /** Typed with a leading "@": people. */
  people: boolean;
};

const TOKEN = /(\w+):("[^"]*"?|\S*)|"[^"]*"?|\S+/g;

export function parseQuery(raw: string): ParsedQuery {
  let input = raw;
  const actions = input.trimStart().startsWith(">");
  if (actions) input = input.trimStart().slice(1);
  const people = input.trimStart().startsWith("@");
  if (people) input = input.trimStart().slice(1);

  const chips: QueryChip[] = [];
  const words: string[] = [];
  let partial: ParsedQuery["partial"] = null;
  const endsOpen = !/\s$/.test(input);

  const tokens = [...input.matchAll(TOKEN)];
  tokens.forEach((match, index) => {
    const last = index === tokens.length - 1;
    const key = match[1] ? KEY_ALIASES[match[1].toLowerCase()] : undefined;
    if (key) {
      const value = (match[2] ?? "").replace(/^"|"$/g, "").trim();
      // Still being typed: offered as a suggestion, not yet applied.
      if (last && endsOpen && (value === "" || FILTER_VALUES[key].length > 0)) {
        const known = FILTER_VALUES[key].some((item) => item.value === value.toLowerCase());
        if (!known) {
          partial = { key, value };
          return;
        }
      }
      if (value) chips.push({ key, value, raw: match[0] });
      return;
    }
    const word = match[0].replace(/^"|"$/g, "");
    if (word) words.push(word);
  });

  return { text: words.join(" "), words, chips, partial, actions, people };
}

/** The query with one filter taken out, as the box should now read. */
export function withoutChip(raw: string, chip: QueryChip) {
  return raw.replace(chip.raw, "").replace(/\s{2,}/g, " ").trimStart();
}

/** The query with the filter being typed finished as `key:value `. */
export function completePartial(raw: string, key: FilterKey, value: string) {
  const written = /\s/.test(value) ? `"${value}"` : value;
  return raw.replace(/(\w+):("[^"]*"?|\S*)$/, `${key}:${written} `);
}

/** A filter added at the end, quoting a value with spaces in it. */
export function withFilter(raw: string, key: FilterKey, value: string) {
  const written = /\s/.test(value) ? `"${value}"` : value;
  const base = raw.trim();
  return `${base ? `${base} ` : ""}${key}:${written} `;
}

/* -------------------------------------------------------------------- calls */

export type SearchType = "tickets" | "people" | "departments" | "units" | "messages" | "files";

/**
 * `size` says how many rows each section may bring: a whole page, or the few
 * that fit beside the other sections. Left out, the server decides by how
 * many sections were asked for.
 */
export function search(
  parsed: Pick<ParsedQuery, "text" | "chips">,
  types: SearchType[],
  signal?: AbortSignal,
  size?: "full" | "preview",
) {
  const params = new URLSearchParams();
  if (parsed.text) params.set("q", parsed.text);
  if (types.length > 0) params.set("types", types.join(","));
  if (size) params.set("size", size);

  const grouped = new Map<FilterKey, string[]>();
  for (const chip of parsed.chips) grouped.set(chip.key, [...(grouped.get(chip.key) ?? []), chip.value]);
  for (const [key, values] of grouped) {
    // Names are one value; the rest are lists.
    params.set(key, key === "dept" || key === "from" || key === "to" ? values[values.length - 1] : values.join(","));
  }

  return api<SearchResults & { success: boolean }>(`/search?${params.toString()}`, { signal });
}

/** One ticket in full, for opening its sheet from wherever the search was. */
export function getTicket(id: string, signal?: AbortSignal) {
  return api<{ ticket: TicketRecord }>(`/tickets/${id}`, { signal }).then((data) => data.ticket);
}

/* ------------------------------------------------------------------ recents */

/** Something opened from the search, kept so the empty box can offer it again. */
export type RecentItem = {
  kind: "ticket" | "person" | "department" | "unit";
  id: string;
  title: string;
  subtitle: string;
};

const RECENT_KEY = "flowdesk.spotlight.recent";
const QUERIES_KEY = "flowdesk.spotlight.queries";
const MAX_RECENT = 6;
const MAX_QUERIES = 5;

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser that will not keep it simply has no recents next time.
  }
}

export const readRecent = () => read<RecentItem>(RECENT_KEY);
export const readQueries = () => read<string>(QUERIES_KEY);

export function rememberItem(item: RecentItem) {
  const rest = readRecent().filter((entry) => !(entry.kind === item.kind && entry.id === item.id));
  write(RECENT_KEY, [item, ...rest].slice(0, MAX_RECENT));
}

export function rememberQuery(query: string) {
  const value = query.trim();
  if (value.length < 2) return;
  const rest = readQueries().filter((entry) => entry.toLowerCase() !== value.toLowerCase());
  write(QUERIES_KEY, [value, ...rest].slice(0, MAX_QUERIES));
}

/** Takes one search out of the list, and answers with what is left. */
export function forgetQuery(query: string) {
  const rest = readQueries().filter((entry) => entry.toLowerCase() !== query.trim().toLowerCase());
  write(QUERIES_KEY, rest);
  return rest;
}

/** Takes one opened item out of the list, and answers with what is left. */
export function forgetItem(item: Pick<RecentItem, "kind" | "id">) {
  const rest = readRecent().filter((entry) => !(entry.kind === item.kind && entry.id === item.id));
  write(RECENT_KEY, rest);
  return rest;
}

export function forgetAllQueries() {
  write(QUERIES_KEY, []);
}

export function forgetAllItems() {
  write(RECENT_KEY, []);
}
