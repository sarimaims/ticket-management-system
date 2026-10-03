"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowRight,
  Building,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  ListFilter,
  type LucideIcon,
  Mail,
  MessageSquareText,
  Paperclip,
  Phone,
  Search,
  Sparkles,
  Ticket,
  Users,
  X,
  Zap,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { TicketDetailSheet, type SheetTab } from "@/components/tickets/ticket-detail-sheet";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { useUserProfile } from "@/components/users/user-profile";
import { errorMessage } from "@/lib/api";
import { canSeeAllTickets, initials, isAdmin } from "@/lib/auth";
import type { LibraryItem } from "@/lib/library";
import {
  completePartial,
  FILTER_HELP,
  FILTER_VALUES,
  forgetAllItems,
  forgetAllQueries,
  forgetItem,
  forgetQuery,
  type FilterKey,
  getTicket,
  NO_RESULTS,
  parseQuery,
  readQueries,
  readRecent,
  type RecentItem,
  rememberItem,
  rememberQuery,
  search,
  type SearchDepartment,
  type SearchMessage,
  type SearchPerson,
  type SearchResults,
  type SearchTicket,
  type SearchType,
  type SearchUnit,
  withFilter,
  withoutChip,
} from "@/lib/search";
import { departmentsOf, type TicketRecord } from "@/lib/tickets";
import { cn } from "@/lib/utils";

import { actionScore, actionsFor, type SpotAction } from "./spotlight-actions";
import {
  ActionPreview,
  DepartmentPreview,
  FilePreview,
  fileSize,
  MessagePreview,
  PersonPreview,
  PreviewButton,
  StatusPill,
  TicketPreview,
  UnitPreview,
  when,
} from "./spotlight-preview";

/* ------------------------------------------------------------------ opening */

type SpotlightApi = { open: (query?: string) => void };

const SpotlightContext = createContext<SpotlightApi | null>(null);

/** Opens the search from anywhere. Outside the provider it does nothing. */
export function useSpotlight(): SpotlightApi {
  return useContext(SpotlightContext) ?? { open: () => {} };
}

const subscribeNothing = () => () => {};

/** ⌘ on a Mac, Ctrl everywhere else - read once, never during a server render. */
export function useModKey() {
  return useSyncExternalStore(
    subscribeNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

/** Whether this is a Mac, read when a key is pressed - never during a server render. */
const onMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** Whether a key press was meant for a field rather than for the page. */
const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));

/**
 * The search, for the whole app: Option+Space on a Mac or Ctrl+Space elsewhere
 * (Alt+Space too, where the browser passes it on), ⌘K / Ctrl+K from anywhere,
 * "/" from anywhere that is not a text field, or the box in the header.
 *
 * It also holds the one ticket sheet a result opens, so a ticket found from
 * the units page opens over the units page - nobody is sent to a list to read
 * one ticket.
 */
export function SpotlightProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const toast = useToast();
  const [shown, setShown] = useState<{ query: string; n: number; closing?: boolean } | null>(null);
  const [sheet, setSheet] = useState<TicketRecord | null>(null);
  const [tab, setTab] = useState<SheetTab>("details");

  const open = useCallback(
    (query = "") => setShown((current) => ({ query, n: (current?.n ?? 0) + 1 })),
    [],
  );
  /** Plays the panel out; it is let go once that has finished, below. */
  const close = useCallback(
    () => setShown((current) => (current && !current.closing ? { ...current, closing: true } : current)),
    [],
  );
  const toggle = useCallback(
    () =>
      setShown((current) =>
        current && !current.closing ? { ...current, closing: true } : { query: "", n: (current?.n ?? 0) + 1 },
      ),
    [],
  );

  // The motion's styles go into the page once, ahead of the first open.
  useEffect(installMotion, []);

  useEffect(() => {
    if (!shown?.closing) return;
    const timer = window.setTimeout(
      () => setShown((current) => (current?.closing ? null : current)),
      CLOSE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * The launcher's own key, from anywhere, fields included: Option+Space on
       * a Mac, Ctrl+Space everywhere else. Windows browsers keep Alt+Space for
       * the window menu and never pass it to the page, so Ctrl stands in for it
       * there - Alt+Space is still caught where a browser does let it through.
       * Matched on the physical key: on a Mac Option+Space types a non-breaking
       * space, so `event.key` is not " ". (Ctrl+Space on a Mac switches input
       * source, so it is left alone.)
       */
      const space = event.code === "Space" && !event.metaKey && !event.shiftKey;
      const altSpace = space && event.altKey && !event.ctrlKey;
      const ctrlSpace = space && event.ctrlKey && !event.altKey && !onMac();
      if (altSpace || ctrlSpace) {
        event.preventDefault();
        toggle();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typingIn(event.target)) {
        event.preventDefault();
        setShown((current) =>
          current && !current.closing ? current : { query: "", n: (current?.n ?? 0) + 1 },
        );
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const openTicket = useCallback(
    (id: string, start: SheetTab = "details") => {
      close();
      getTicket(id)
        .then((ticket) => {
          setTab(start);
          setSheet(ticket);
        })
        .catch((error) => toast.error("Could not open the ticket", errorMessage(error)));
    },
    [toast, close],
  );

  const api = useMemo(() => ({ open }), [open]);

  const manager = isAdmin(session);
  const mine = new Set((session?.departments ?? []).map((membership) => membership.id));
  const canWork = sheet ? manager || departmentsOf(sheet).some((department) => mine.has(department.id)) : false;
  const canEdit = sheet ? manager || sheet.raisedBy.id === session?.id : false;
  const following = Boolean(sheet) && !canWork && !canEdit;

  return (
    <SpotlightContext.Provider value={api}>
      {children}
      {shown && (
        <SpotlightPanel
          key={shown.n}
          closing={Boolean(shown.closing)}
          initialQuery={shown.query}
          onClose={close}
          onOpenTicket={openTicket}
        />
      )}
      <TicketDetailSheet
        ticket={sheet}
        canWork={canWork}
        canEdit={canEdit}
        tab={tab}
        onTab={setTab}
        onClose={() => setSheet(null)}
        onSaved={setSheet}
        readOnly={
          following
            ? "You are following this as head of the raising department. You can chat on it; only the people on the ticket can change it."
            : undefined
        }
      />
    </SpotlightContext.Provider>
  );
}

/* ------------------------------------------------------------------- scopes */

type Scope = "all" | "tickets" | "people" | "files" | "places" | "chat" | "actions";

const SCOPES: { id: Scope; label: string; icon: LucideIcon; placeholder: string }[] = [
  { id: "all", label: "All", icon: Sparkles, placeholder: "Search tickets, people, files and more" },
  { id: "tickets", label: "Tickets", icon: Ticket, placeholder: "Search tickets by number, subject or filter" },
  { id: "people", label: "People", icon: Users, placeholder: "Search people by name, email or role" },
  { id: "files", label: "Files", icon: Paperclip, placeholder: "Search photos, videos, documents and links" },
  { id: "places", label: "Departments", icon: Building, placeholder: "Search departments and units" },
  { id: "chat", label: "Conversations", icon: MessageSquareText, placeholder: "Search what was said on tickets" },
  { id: "actions", label: "Actions", icon: Zap, placeholder: "Go somewhere or do something" },
];

/** Asked of the box with nothing typed: the filters people reach for most. */
const QUICK_FILTERS: { query: string; label: string }[] = [
  { query: "is:assigned status:open ", label: "My open work" },
  { query: "is:today ", label: "Due today" },
  { query: "status:overdue ", label: "Overdue" },
  { query: "priority:urgent status:open ", label: "Urgent and open" },
  { query: "is:mine status:open ", label: "My open requests" },
  { query: "is:approval ", label: "Awaiting approval" },
];

/* --------------------------------------------------------------------- hits */

type Hit =
  | { kind: "ticket"; key: string; item: SearchTicket }
  | { kind: "person"; key: string; item: SearchPerson }
  | { kind: "department"; key: string; item: SearchDepartment }
  | { kind: "unit"; key: string; item: SearchUnit }
  | { kind: "file"; key: string; item: LibraryItem }
  | { kind: "message"; key: string; item: SearchMessage }
  | { kind: "action"; key: string; item: SpotAction }
  | { kind: "filter"; key: string; filter: FilterKey; value: string; label: string }
  | { kind: "query"; key: string; query: string; label: string; icon: "recent" | "filter" }
  | { kind: "recent"; key: string; item: RecentItem }
  | { kind: "more"; key: string; scope: Scope; label: string };

type Section = {
  id: string;
  title: string;
  hits: Hit[];
  /** A list of the reader's own history, which they may empty. */
  clear?: "recent" | "queries";
};

/** How a hit is opened: plainly, with ⌘/Ctrl (somewhere else), or with Alt (the other thing). */
type Mode = "open" | "reveal" | "alt";

const FILES_IN_ALL = 5;

function filterLabel(key: FilterKey) {
  return { status: "Status", priority: "Priority", dept: "Department", from: "Raised by", to: "Assigned to", is: "Is", has: "Has" }[key];
}

/** The words of the search in bold, wherever they fall in the text. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  const usable = words.filter((word) => word.length > 0).map((word) => word.replace(/^#/, ""));
  if (usable.length === 0 || !text) return <>{text}</>;
  const pattern = new RegExp(`(${usable.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="font-bold">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/** The small tinted square each row starts with, so a kind reads at a glance. */
function Glyph({ kind, className, children }: { kind: string; className?: string; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    ticket: "from-brand-500 to-brand-700 text-white",
    department: "from-violet-400 to-violet-600 text-white",
    unit: "from-sky-400 to-sky-600 text-white",
    image: "from-emerald-400 to-emerald-600 text-white",
    video: "from-fuchsia-400 to-fuchsia-600 text-white",
    document: "from-slate-400 to-slate-600 text-white",
    link: "from-sky-400 to-blue-600 text-white",
    action: "from-ink-600 to-ink-800 text-white",
    filter: "from-amber-300 to-amber-500 text-white",
    recent: "from-ink-200 to-ink-300 text-ink-600",
    more: "from-ink-100 to-ink-200 text-ink-500",
  };
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-b shadow-xs",
        tones[kind] ?? tones.more,
        className,
      )}
    >
      {children}
    </span>
  );
}

const FILE_ICON: Record<LibraryItem["type"], LucideIcon> = {
  image: ImageIcon,
  video: Film,
  document: FileText,
  link: Link2,
};

/* ------------------------------------------------------------------- motion */

/** How long the panel takes to play out before it is gone. */
const CLOSE_MS = 170;

/** The pause after a key before asking, so each letter is not its own request. */
const TYPING_PAUSE_MS = 120;

/*
 * The motion, in one place. Everything moves on transform and opacity - the
 * two things a browser can animate without laying the page out again - with
 * the spring-like curve Apple uses for its sheets: quick to start, long to
 * settle. Nothing here runs for someone who has asked for less motion.
 */
const EASE = "cubic-bezier(.32,.72,0,1)";
const SPOTLIGHT_CSS = `
@keyframes sl-in{from{opacity:0;transform:translate3d(0,-14px,0) scale(.96)}to{opacity:1;transform:none}}
@keyframes sl-out{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(0,-8px,0) scale(.975)}}
@keyframes sl-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sl-fade-out{from{opacity:1}to{opacity:0}}
@keyframes sl-row{from{opacity:0;transform:translate3d(0,6px,0)}to{opacity:1;transform:none}}
@keyframes sl-preview{from{opacity:0;transform:translate3d(0,6px,0) scale(.985)}to{opacity:1;transform:none}}
@keyframes sl-pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
@keyframes sl-bar{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
@keyframes sl-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.sl-backdrop{animation:sl-fade-in 240ms ease-out both}
.sl-panel{transform-origin:50% 0;animation:sl-in 380ms ${EASE} both}
.sl-root[data-state=closing]{pointer-events:none}
.sl-root[data-state=closing] .sl-backdrop{animation:sl-fade-out ${CLOSE_MS}ms ease-in both}
.sl-root[data-state=closing] .sl-panel{animation:sl-out ${CLOSE_MS}ms cubic-bezier(.4,0,1,1) both}
.sl-row{animation:sl-row 260ms ${EASE} both}
.sl-preview{animation:sl-preview 220ms ${EASE} both}
.sl-pop{animation:sl-pop 240ms cubic-bezier(.34,1.56,.64,1) both}
.sl-pill{background:#0a66e4;box-shadow:inset 0 .5px 0 rgba(255,255,255,.25),0 1px 2px rgba(10,102,228,.25);opacity:0;transition:transform 200ms ${EASE},height 200ms ${EASE},opacity 140ms ease;will-change:transform}
.sl-tab{transition:transform 320ms ${EASE}}
.sl-collapse{display:grid;grid-template-rows:0fr;transition:grid-template-rows 280ms ${EASE}}
.sl-collapse[data-open=true]{grid-template-rows:1fr}
.sl-progress{opacity:0;transition:opacity 180ms ease}
.sl-progress.is-loading{opacity:1;transition-delay:160ms}
.sl-progress span{position:absolute;top:0;bottom:0;left:0;width:30%;background:linear-gradient(90deg,transparent,#0a66e4,transparent);animation:sl-bar 1.1s cubic-bezier(.45,0,.25,1) infinite}
.sl-shimmer{animation:sl-pulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.sl-root,.sl-root *{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
`;

/**
 * Puts the motion's styles into the page, once. Read before the panel ever
 * opens, so opening it costs no stylesheet work - only the panel itself.
 */
function installMotion() {
  if (document.getElementById("spotlight-motion")) return;
  const style = document.createElement("style");
  style.id = "spotlight-motion";
  style.textContent = SPOTLIGHT_CSS;
  document.head.appendChild(style);
}

/** Rows standing in for results that are on their way, so the panel never sits empty. */
function SkeletonRows() {
  return (
    <div aria-hidden className="space-y-0.5 pt-1">
      <div className="mx-2.5 mt-1 mb-2 h-2.5 w-16 rounded bg-ink-900/[0.06]" />
      {[72, 58, 80, 64, 50, 68].map((width, index) => (
        <div
          key={index}
          className="sl-shimmer flex items-center gap-2.5 rounded-[10px] px-2.5 py-2"
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <span className="size-7 shrink-0 rounded-lg bg-ink-900/[0.06]" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-2.5 rounded bg-ink-900/[0.07]" style={{ width: `${width}%` }} />
            <span className="block h-2 w-2/5 rounded bg-ink-900/[0.05]" />
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- panel */

function SpotlightPanel({
  closing,
  initialQuery,
  onClose,
  onOpenTicket,
}: {
  /** Playing out: drawn as it was, taking no more input. */
  closing: boolean;
  initialQuery: string;
  onClose: () => void;
  onOpenTicket: (id: string, tab?: SheetTab) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const openProfile = useUserProfile();
  const { session } = useAuth();
  const mod = useModKey();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<Scope>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    key: string;
    /** Every part of this answer has arrived, not only the quick one. */
    complete: boolean;
    results: SearchResults;
    files: LibraryItem[];
    error?: string;
  } | null>(null);
  // Read once on open; the box is short-lived, so it never needs to follow them.
  const [recent, setRecent] = useState(readRecent);
  const [queries, setQueries] = useState(readQueries);
  const cache = useRef(new Map<string, { results: SearchResults; files: LibraryItem[] }>());

  const manager = isAdmin(session);
  const actions = useMemo(() => actionsFor(session), [session]);
  /*
   * The box shows every key the moment it is pressed; the list beneath
   * follows a beat behind. React draws the input first and the results when
   * it has time, so typing never waits on the list being redrawn.
   */
  const deferredQuery = useDeferredValue(query);
  /*
   * Opening draws the shell first - the bar, the frame, the empty list - so
   * the panel starts moving at once; the rows and the preview follow a frame
   * later, as interruptible work that never holds an animation frame up.
   */
  const ready = useDeferredValue(true, false);
  const parsed = useMemo(() => parseQuery(deferredQuery), [deferredQuery]);

  /** "@" asks for people and ">" for actions, as they do in a command palette. */
  const active: Scope = parsed.actions ? "actions" : parsed.people && scope === "all" ? "people" : scope;
  const filtered = parsed.chips.length > 0;
  const blank = !parsed.text && !filtered;

  /*
   * What to ask the server, as one string: the effect below runs when it
   * changes. Two requests rather than one, so the quick sections never wait
   * on the slow: tickets, people and places first, then what was said and
   * the files, which land when they are ready.
   */
  const quick: SearchType[] | null =
    active === "all"
      ? blank
        ? null
        : filtered
          ? ["tickets"]
          : ["tickets", "people", "departments", ...(manager ? (["units"] as SearchType[]) : [])]
      : active === "tickets"
        ? ["tickets"]
        : active === "people"
          ? ["people"]
          : active === "places"
            ? manager
              ? ["departments", "units"]
              : ["departments"]
            : null;
  const wantsMessages =
    (active === "all" && !filtered && parsed.text.length >= 3) || (active === "chat" && parsed.text.length > 0);
  const wantsFiles = active === "files" || (active === "all" && parsed.text.length >= 2 && !filtered);
  const requestKey = JSON.stringify({
    quick,
    messages: wantsMessages,
    files: wantsFiles,
    size: active === "all" ? "preview" : "full",
    text: parsed.text,
    chips: parsed.chips.map((chip) => [chip.key, chip.value]),
  });
  const asking = quick !== null || wantsMessages || wantsFiles;

  useEffect(() => {
    const request = JSON.parse(requestKey) as {
      quick: SearchType[] | null;
      messages: boolean;
      files: boolean;
      size: "full" | "preview";
      text: string;
      chips: [FilterKey, string][];
    };
    if (!request.quick && !request.messages && !request.files) return;

    const controller = new AbortController();
    const known = cache.current.get(requestKey);
    const asked = { text: request.text, chips: request.chips.map(([key, value]) => ({ key, value, raw: "" })) };

    // Each half lands as it arrives; until the other does, what was there stays.
    let quickPart: SearchResults | null = request.quick ? null : NO_RESULTS;
    let slowPart: { messages: SearchResults["messages"]; files: LibraryItem[] } | null =
      request.messages || request.files ? null : { messages: NO_RESULTS.messages, files: [] };

    const publish = () => {
      const fast = quickPart;
      const slow = slowPart;
      if (fast && slow) cache.current.set(requestKey, { results: { ...fast, messages: slow.messages }, files: slow.files });
      // Drawn as interruptible work: a long list arriving never stalls a frame, or a key.
      startTransition(() => setAnswer((previous) => ({
        key: requestKey,
        complete: Boolean(fast && slow),
        results: {
          ...(fast ?? previous?.results ?? NO_RESULTS),
          messages: slow ? slow.messages : (previous?.results.messages ?? NO_RESULTS.messages),
        },
        files: slow ? slow.files : (previous?.files ?? []),
      })));
    };
    const fail = (error: unknown) => {
      if (controller.signal.aborted) return;
      setAnswer({ key: requestKey, complete: true, results: NO_RESULTS, files: [], error: errorMessage(error) });
    };

    const timer = window.setTimeout(
      () => {
        if (known) {
          startTransition(() => setAnswer({ key: requestKey, complete: true, ...known }));
          return;
        }
        if (request.quick) {
          search(asked, request.quick, controller.signal, request.size)
            .then((results) => {
              quickPart = results;
              publish();
            })
            .catch(fail);
        }
        if (request.messages || request.files) {
          // What was said and the files, in one request - both by the reader's level.
          const slowTypes: SearchType[] = [
            ...(request.messages ? (["messages"] as SearchType[]) : []),
            ...(request.files ? (["files"] as SearchType[]) : []),
          ];
          search(asked, slowTypes, controller.signal, request.size)
            .then((results) => {
              slowPart = { messages: results.messages, files: results.files.items };
              publish();
            })
            .catch(fail);
        }
      },
      known ? 0 : TYPING_PAUSE_MS,
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey]);

  const loading = asking && !(answer?.key === requestKey && answer.complete);
  // The last answer stays up while the next is on its way, as Spotlight does,
  // so the list does not flash empty between letters.
  const results = asking && answer ? answer.results : NO_RESULTS;
  const files = useMemo(() => (asking && answer ? answer.files : []), [asking, answer]);

  /* ------------------------------------------------------------- sections */

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const words = parsed.words;

    // A filter being typed: what it can be.
    if (parsed.partial) {
      const { key, value } = parsed.partial;
      const typed = value.toLowerCase();
      const options = FILTER_VALUES[key].filter(
        (option) => !typed || option.value.startsWith(typed) || option.label.toLowerCase().includes(typed),
      );
      if (options.length > 0) {
        out.push({
          id: "filter",
          title: `${filterLabel(key)} filter`,
          hits: options.map((option) => ({
            kind: "filter",
            key: `filter:${key}:${option.value}`,
            filter: key,
            value: option.value,
            label: option.label,
          })),
        });
      }
      if (blank) return out;
    }

    // A word that is the start of a filter's name offers the filter.
    const last = words[words.length - 1]?.toLowerCase() ?? "";
    if (!parsed.partial && last.length >= 2 && active !== "actions" && !/\s$/.test(deferredQuery)) {
      const offered = FILTER_HELP.filter((help) => help.key.startsWith(last) || filterLabel(help.key).toLowerCase().startsWith(last));
      if (offered.length > 0) {
        out.push({
          id: "filter-keys",
          title: "Filters",
          hits: offered.map((help) => ({
            kind: "query",
            key: `key:${help.key}`,
            query: deferredQuery.replace(/\S+$/, `${help.key}:`),
            label: `${help.key}: - ${help.label}`,
            icon: "filter",
          })),
        });
      }
    }

    const scored = actions
      .map((action) => ({ action, score: actionScore(action, parsed.text) }))
      .filter((entry): entry is { action: SpotAction; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score);

    if (active === "actions") {
      for (const group of ["Create", "Go to", "Views"] as const) {
        const hits = scored
          .filter((entry) => entry.action.group === group)
          .map(({ action }): Hit => ({ kind: "action", key: `action:${action.id}`, item: action }));
        if (hits.length > 0) out.push({ id: `actions-${group}`, title: group, hits });
      }
      return out;
    }

    // Nothing typed on All: where to start.
    if (active === "all" && blank) {
      if (recent.length > 0) {
        out.push({
          id: "recent",
          title: "Recently opened",
          clear: "recent",
          hits: recent.map((item) => ({ kind: "recent", key: `recent:${item.kind}:${item.id}`, item })),
        });
      }
      if (queries.length > 0) {
        out.push({
          id: "queries",
          title: "Recent searches",
          clear: "queries",
          hits: queries.map((value) => ({
            kind: "query",
            key: `q:${value}`,
            query: `${value} `,
            label: value,
            icon: "recent",
          })),
        });
      }
      out.push({
        id: "quick",
        title: "Quick filters",
        hits: QUICK_FILTERS.map((item) => ({
          kind: "query",
          key: `quick:${item.query}`,
          query: item.query,
          label: item.label,
          icon: "filter",
        })),
      });
      out.push({
        id: "suggested",
        title: "Actions",
        hits: actions
          .filter((action) => action.group === "Create" || action.id === "go-assigned" || action.id === "go-requests")
          .map((action) => ({ kind: "action", key: `action:${action.id}`, item: action })),
      });
      return out;
    }

    const tickets = results.tickets.items.map((item): Hit => ({ kind: "ticket", key: `ticket:${item.id}`, item }));
    const people = results.people.items.map((item): Hit => ({ kind: "person", key: `person:${item.id}`, item }));
    const departments = results.departments.items.map(
      (item): Hit => ({ kind: "department", key: `department:${item.id}`, item }),
    );
    const units = results.units.items.map((item): Hit => ({ kind: "unit", key: `unit:${item.id}`, item }));
    const messages = results.messages.items.map(
      (item): Hit => ({ kind: "message", key: `message:${item.id}`, item }),
    );
    const fileHits = files.map((item): Hit => ({ kind: "file", key: `file:${item.id}`, item }));
    const more = (scope: Scope, label: string): Hit => ({ kind: "more", key: `more:${scope}`, scope, label });

    if (active === "all") {
      const phrase = parsed.text.toLowerCase();
      const numbered = results.tickets.items.find((item) =>
        words.some((word) => {
          const digits = word.replace(/^(#|tk-?)/i, "");
          return /^\d+$/.test(digits) && Number(item.number.replace(/\D/g, "")) === Number(digits);
        }),
      );
      const quick = scored.find((entry) => entry.score <= 1);
      const named = results.people.items.find((item) => item.name.toLowerCase().startsWith(phrase));
      const place = results.departments.items.find((item) => item.name.toLowerCase().startsWith(phrase));

      // The one result most likely meant, on top and on its own, as Spotlight's Top Hit.
      const top: Hit | undefined = numbered
        ? tickets.find((hit) => hit.key === `ticket:${numbered.id}`)
        : quick && quick.score === 0
          ? { kind: "action", key: `action:${quick.action.id}`, item: quick.action }
          : named && phrase.length >= 2
            ? people.find((hit) => hit.key === `person:${named.id}`)
            : place && phrase.length >= 2
              ? departments.find((hit) => hit.key === `department:${place.id}`)
              : quick
                ? { kind: "action", key: `action:${quick.action.id}`, item: quick.action }
                : (tickets[0] ?? people[0] ?? departments[0] ?? fileHits[0]);

      if (top) out.push({ id: "top", title: "Top hit", hits: [top] });
      const rest = (hits: Hit[]) => hits.filter((hit) => hit.key !== top?.key);

      const actionHits = rest(
        scored
          .filter((entry) => entry.score <= 2)
          .slice(0, 3)
          .map(({ action }): Hit => ({ kind: "action", key: `action:${action.id}`, item: action })),
      );
      if (actionHits.length > 0 && !filtered) out.push({ id: "actions", title: "Actions", hits: actionHits });

      const add = (id: string, title: string, hits: Hit[], scopeFor: Scope, hasMore: boolean) => {
        const shown = rest(hits);
        if (shown.length === 0) return;
        out.push({
          id,
          title,
          hits: hasMore ? [...shown, more(scopeFor, `Show all ${title.toLowerCase()}`)] : shown,
        });
      };
      add("tickets", "Tickets", tickets, "tickets", results.tickets.more);
      add("people", "People", people, "people", results.people.more);
      add("departments", "Departments", [...departments, ...units], "places", results.departments.more);
      add("files", "Files", fileHits.slice(0, FILES_IN_ALL), "files", fileHits.length > FILES_IN_ALL);
      add("messages", "Conversations", messages, "chat", results.messages.more);
      return out;
    }

    const titled: Record<Exclude<Scope, "all" | "actions">, [string, Hit[]][]> = {
      tickets: [[blank ? "Recently updated" : "Tickets", tickets]],
      people: [["People", people]],
      places: [
        ["Departments", departments],
        ["Units", units],
      ],
      files: [
        ["Photos", fileHits.filter((hit) => hit.kind === "file" && hit.item.type === "image")],
        ["Videos", fileHits.filter((hit) => hit.kind === "file" && hit.item.type === "video")],
        ["Documents", fileHits.filter((hit) => hit.kind === "file" && hit.item.type === "document")],
        ["Links", fileHits.filter((hit) => hit.kind === "file" && hit.item.type === "link")],
      ],
      chat: [["Conversations", messages]],
    };
    for (const [title, hits] of titled[active]) {
      if (hits.length > 0) out.push({ id: title, title, hits: hits.slice(0, 40) });
    }
    return out;
  }, [parsed, deferredQuery, active, blank, filtered, actions, recent, queries, results, files]);

  const hits = useMemo(() => sections.flatMap((section) => section.hits), [sections]);
  /** Where each row sits in the whole list, for the stagger as rows arrive. */
  const order = useMemo(() => new Map(hits.map((hit, index) => [hit.key, index])), [hits]);
  const selected = hits.find((hit) => hit.key === selectedKey) ?? hits[0] ?? null;

  /*
   * The highlight is one element that glides to the chosen row, rather than
   * each row lighting up on its own - so moving through the list slides, as
   * Spotlight's does. Placed by hand before paint: no state, so moving it
   * redraws nothing else.
   */
  useLayoutEffect(() => {
    const marker = pill.current;
    if (!marker) return;
    const row = selected
      ? track.current?.querySelector<HTMLElement>(`[data-hit="${CSS.escape(selected.key)}"]`)
      : null;
    if (!row) {
      marker.style.opacity = "0";
      return;
    }
    // Arriving from nowhere it appears in place; from another row it glides.
    const arriving = marker.style.opacity !== "1";
    if (arriving) marker.style.transition = "none";
    marker.style.transform = `translate3d(0, ${row.offsetTop}px, 0)`;
    marker.style.height = `${row.offsetHeight}px`;
    marker.style.opacity = "1";
    if (arriving) {
      void marker.offsetHeight;
      marker.style.transition = "";
    }
    row.scrollIntoView({ block: "nearest" });
  }, [selected, sections, ready]);

  /* --------------------------------------------------------------- acting */

  const meId = session?.id;
  const overseer = canSeeAllTickets(session);
  /** The list a ticket sits on for this reader, with its sheet open. */
  const listHref = (ticket: { id: string; raisedById: string }) =>
    `${ticket.raisedById === meId ? "/my-requests" : overseer ? "/all-tickets" : "/assigned-to-me"}?ticket=${ticket.id}&open=1`;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const ask = (next: string, nextScope?: Scope) => {
    setQuery(next);
    if (nextScope) setScope(nextScope);
    setSelectedKey(null);
    input.current?.focus();
  };

  const copy = (text: string, what: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`${what} copied`))
      .catch(() => toast.error("Could not copy"));
  };

  const run = (hit: Hit, mode: Mode = "open") => {
    if (parsed.text && !["filter", "query", "more"].includes(hit.kind)) rememberQuery(query);

    switch (hit.kind) {
      case "ticket": {
        const ticket = hit.item;
        rememberItem({ kind: "ticket", id: ticket.id, title: ticket.subject, subtitle: ticket.number });
        if (mode === "reveal") go(listHref({ id: ticket.id, raisedById: ticket.raisedBy.id }));
        else onOpenTicket(ticket.id, mode === "alt" ? "chat" : "details");
        return;
      }
      case "person": {
        const person = hit.item;
        if (mode === "reveal") return ask(withFilter("", "from", person.name), "tickets");
        if (mode === "alt") return void window.open(`mailto:${person.email}`);
        rememberItem({ kind: "person", id: person.id, title: person.name, subtitle: person.designation });
        onClose();
        openProfile(person.id, person.name);
        return;
      }
      case "department": {
        const department = hit.item;
        if (mode === "reveal") return ask(withFilter("", "dept", department.name), "tickets");
        rememberItem({
          kind: "department",
          id: department.id,
          title: department.name,
          subtitle: department.unit?.name ?? "",
        });
        go(department.canOpen ? `/departments/${department.id}` : "/create-ticket");
        return;
      }
      case "unit":
        rememberItem({ kind: "unit", id: hit.item.id, title: hit.item.name, subtitle: "Unit" });
        go(`/units/${hit.item.id}`);
        return;
      case "file": {
        const item = hit.item;
        if (mode === "reveal") return onOpenTicket(item.ticket.id, item.from === "chat" ? "chat" : "details");
        if (mode === "alt" && item.type !== "link") return void window.open(item.downloadUrl, "_blank");
        window.open(item.url, "_blank", "noopener");
        return;
      }
      case "message":
        if (mode === "reveal") return go(listHref({ id: hit.item.ticket.id, raisedById: "" }));
        onOpenTicket(hit.item.ticket.id, "chat");
        return;
      case "action":
        go(hit.item.href);
        return;
      case "filter":
        return ask(completePartial(query, hit.filter, hit.value));
      case "query":
        return ask(hit.query);
      case "more":
        return ask(query, hit.scope);
      case "recent": {
        const item = hit.item;
        rememberItem(item);
        if (item.kind === "ticket") onOpenTicket(item.id);
        else if (item.kind === "person") {
          onClose();
          openProfile(item.id, item.title);
        } else go(item.kind === "unit" ? `/units/${item.id}` : `/departments/${item.id}`);
      }
    }
  };

  /* ------------------------------------------------------------- keyboard */

  const move = (step: number) => {
    if (hits.length === 0) return;
    const at = selected ? hits.indexOf(selected) : -1;
    setSelectedKey(hits[(at + step + hits.length) % hits.length].key);
  };

  const jump = (step: number) => {
    if (sections.length === 0) return;
    const at = sections.findIndex((section) => section.hits.some((hit) => hit.key === selected?.key));
    const next = sections[(at + step + sections.length) % sections.length];
    setSelectedKey(next.hits[0].key);
  };

  const scopeIds = SCOPES.map((item) => item.id);
  const switchScope = (next: Scope) => {
    setScope(next);
    setSelectedKey(null);
    // Leaving the actions list leaves its ">" behind too.
    if (next !== "actions" && parsed.actions) setQuery(query.replace(/^\s*>/, ""));
    input.current?.focus();
  };

  /** What the reader searched and opened is theirs to tidy away. */
  const removable = (hit: Hit) => hit.kind === "recent" || (hit.kind === "query" && hit.icon === "recent");

  const forget = (hit: Hit) => {
    // The highlight moves to the row that slides up into the gap - or, at the
    // end of the list, back one - so pressing Delete again keeps clearing it.
    const at = hits.indexOf(hit);
    const next =
      [hits[at + 1], hits[at - 1]].find((other) => other && other.kind === hit.kind && removable(other)) ??
      hits[at + 1] ??
      hits[at - 1];
    if (hit.kind === "recent") setRecent(forgetItem(hit.item));
    else if (hit.kind === "query") setQueries(forgetQuery(hit.label));
    setSelectedKey(next && next.key !== hit.key ? next.key : null);
    input.current?.focus();
  };

  const clearAll = (which: "recent" | "queries") => {
    if (which === "recent") {
      forgetAllItems();
      setRecent([]);
    } else {
      forgetAllQueries();
      setQueries([]);
    }
    setSelectedKey(null);
    input.current?.focus();
  };

  /*
   * The rows are handed the same three functions on every render, which read
   * the latest state through a ref - so moving the highlight redraws the two
   * rows it left and reached, not the whole list.
   */
  const latest = useRef({ run, forget });
  useLayoutEffect(() => {
    latest.current = { run, forget };
  });
  const runRow = useCallback((hit: Hit, mode: Mode) => latest.current.run(hit, mode), []);
  const removeRow = useCallback((hit: Hit) => latest.current.forget(hit), []);
  const hoverRow = useCallback((key: string) => setSelectedKey(key), []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mods = event.metaKey || event.ctrlKey;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Tab") {
      event.preventDefault();
      // Tab finishes a filter being typed; otherwise it moves between sections.
      if (selected?.kind === "filter" && !event.shiftKey) run(selected);
      else jump(event.shiftKey ? -1 : 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (selected) run(selected, mods ? "reveal" : event.altKey ? "alt" : "open");
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // First Escape clears, the second closes - as Spotlight does.
      if (query) ask("");
      else if (scope !== "all") switchScope("all");
      else onClose();
    } else if (event.altKey && /^Digit[1-7]$/.test(event.code)) {
      event.preventDefault();
      switchScope(scopeIds[Number(event.code.slice(5)) - 1]);
    } else if (!query && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const at = scopeIds.indexOf(scope);
      switchScope(scopeIds[(at + (event.key === "ArrowRight" ? 1 : -1) + scopeIds.length) % scopeIds.length]);
    } else if (
      !query &&
      selected &&
      removable(selected) &&
      (event.key === "Delete" || (event.key === "Backspace" && event.shiftKey))
    ) {
      // Delete, or Shift+Backspace, as a browser forgets a remembered entry.
      event.preventDefault();
      forget(selected);
    } else if (event.key === "Backspace" && !query && scope !== "all") {
      switchScope("all");
    }
  };

  /* --------------------------------------------------------------- render */

  const current = SCOPES.find((item) => item.id === active) ?? SCOPES[0];
  const nothing = !loading && hits.length === 0 && (asking || parsed.text.length > 0);

  const scopeAt = Math.max(0, SCOPES.findIndex((item) => item.id === active));

  return (
    <div
      data-state={closing ? "closing" : "open"}
      className="sl-root fixed inset-0 z-[70] flex justify-center px-3 pt-[9vh] sm:px-4 sm:pt-[12vh]"
      onKeyDown={closing ? undefined : onKeyDown}
    >
      <div aria-hidden onClick={onClose} className="sl-backdrop fixed inset-0 bg-ink-900/25" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className={cn(
          "sl-panel relative flex h-fit w-full max-w-[820px] flex-col overflow-hidden rounded-[22px]",
          "border border-white/70 bg-white/85 backdrop-blur-2xl backdrop-saturate-150",
          "shadow-[0_32px_90px_-18px_rgba(15,23,42,0.45),0_0_0_0.5px_rgba(15,23,42,0.14)]",
        )}
      >
        {/* The bar: what is being searched, the box, and the browse modes. */}
        <div className="relative flex h-14 shrink-0 items-center gap-2.5 px-4">
          <Search className="size-5 shrink-0 text-ink-400" strokeWidth={2.25} />
          {active !== "all" && (
            <button
              key={active}
              type="button"
              onClick={() => switchScope("all")}
              title="Search everything (Backspace)"
              className="sl-pop inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-ink-900/[0.07] px-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-900/10"
            >
              <current.icon className="size-3.5" />
              {current.label}
              <X className="size-3 text-ink-400" />
            </button>
          )}
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedKey(null);
            }}
            placeholder={current.placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-label="Search"
            aria-controls="spotlight-results"
            aria-activedescendant={selected ? `hit-${selected.key}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-[19px] font-medium tracking-tight text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-400"
          />

          <div className="relative hidden shrink-0 items-center gap-0.5 sm:flex" role="tablist" aria-label="Search in">
            {/* One dark disc that slides to the chosen mode. */}
            <span
              aria-hidden
              className="sl-tab pointer-events-none absolute top-0 left-0 size-8 rounded-full bg-ink-900 shadow-sm"
              style={{ transform: `translate3d(${scopeAt * 34}px, 0, 0)` }}
            />
            {SCOPES.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active === item.id}
                onClick={() => switchScope(item.id)}
                title={`${item.label}  (Alt+${index + 1})`}
                className={cn(
                  "relative grid size-8 cursor-pointer place-items-center rounded-full transition-colors duration-200",
                  active === item.id ? "text-white" : "text-ink-500 hover:bg-ink-900/[0.06] hover:text-ink-800",
                )}
              >
                <item.icon className="size-4" />
              </button>
            ))}
          </div>

          {/* Working on it: a thin line under the bar - only if the answer is not instant. */}
          <div
            aria-hidden
            className={cn("sl-progress pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden", loading && "is-loading")}
          >
            <span />
          </div>
        </div>

        {/* The filters in force, each one click from gone - the row opens and closes rather than jumping. */}
        <div className="sl-collapse" data-open={parsed.chips.length > 0}>
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-900/[0.06] px-4 py-2">
              <ListFilter className="size-3.5 text-ink-400" />
              {parsed.chips.map((chip) => (
                <span
                  key={chip.raw}
                  className="sl-pop inline-flex items-center gap-1 rounded-full bg-amber-100 py-0.5 pr-1 pl-2 text-[11px] font-semibold text-amber-800"
                >
                  {filterLabel(chip.key)}: {chip.value}
                  <button
                    type="button"
                    onClick={() => ask(withoutChip(query, chip))}
                    aria-label={`Remove ${filterLabel(chip.key)} filter`}
                    className="grid size-4 cursor-pointer place-items-center rounded-full hover:bg-amber-200"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* On a phone the browse modes are a row of their own. */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-ink-900/[0.06] px-3 py-1.5 [scrollbar-width:none] sm:hidden">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => switchScope(item.id)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold transition-colors duration-200",
                active === item.id ? "bg-ink-900 text-white" : "bg-ink-900/[0.05] text-ink-600",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        {/* A steady height: the list changes under the box, the box does not change shape. */}
        <div className="flex h-[min(452px,56vh)] min-h-0 border-t border-ink-900/[0.07]">
          {/* Results */}
          <div
            ref={list}
            id="spotlight-results"
            role="listbox"
            aria-label="Results"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5 md:max-w-[460px]"
          >
            <div ref={track} className="relative">
              <div ref={pill} aria-hidden className="sl-pill pointer-events-none absolute inset-x-0 top-0 rounded-[10px]" />

              {answer?.error && answer.key === requestKey && (
                <p className="px-3 py-6 text-center text-[13px] text-status-overdue-fg">{answer.error}</p>
              )}
              {loading && hits.length === 0 && !answer?.error && <SkeletonRows />}
              {nothing && !answer?.error && (
                <div className="sl-preview px-3 py-10 text-center">
                  <Search className="mx-auto size-8 text-ink-300" />
                  <p className="mt-2 text-[14px] font-semibold text-ink-700">No results{parsed.text && ` for “${parsed.text}”`}</p>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {active === "all" ? "Try fewer words, or a filter such as status:open." : `Nothing in ${current.label.toLowerCase()}. Try All.`}
                  </p>
                </div>
              )}
              {!nothing && hits.length === 0 && active === "chat" && !parsed.text && (
                <p className="px-3 py-10 text-center text-[13px] text-ink-500">Type a word or two to search every conversation you can read.</p>
              )}
              {ready && sections.map((section) => (
                <div key={section.id} role="group" aria-label={section.title} className="pb-1">
                  <p className="flex items-center justify-between px-2.5 pt-2 pb-1 text-[11px] font-semibold text-ink-400">
                    {section.title}
                    {section.clear && (
                      <button
                        type="button"
                        // Keeps the cursor in the box, so typing carries on.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => clearAll(section.clear!)}
                        className="cursor-pointer rounded px-1 font-semibold text-ink-400 transition-colors hover:bg-ink-900/[0.06] hover:text-ink-700"
                      >
                        Clear
                      </button>
                    )}
                  </p>
                  {section.hits.map((hit) => (
                    <HitRow
                      key={hit.key}
                      hit={hit}
                      index={order.get(hit.key) ?? 0}
                      top={section.id === "top"}
                      selected={selected?.key === hit.key}
                      words={parsed.words}
                      removable={removable(hit)}
                      onHover={hoverRow}
                      onRun={runRow}
                      onRemove={removeRow}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Preview: what the chosen row is, without opening it - crossfading as the choice moves. */}
          <aside
            aria-label="Preview"
            className="hidden min-h-0 w-[340px] shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-ink-900/[0.07] bg-white/40 md:flex"
          >
            {ready && <div key={selected?.key ?? "tips"} className="sl-preview flex flex-1 flex-col">
              <Preview
                hit={selected}
                mod={mod}
                onRun={(mode) => selected && run(selected, mode)}
                onCopy={copy}
                ticketLink={(ticket) => `${window.location.origin}${listHref(ticket)}`}
                onAsk={ask}
              />
            </div>}
          </aside>
        </div>

        {/* The keys, for whatever is chosen. */}
        <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-ink-900/[0.07] bg-ink-900/[0.025] px-4 text-[11px] text-ink-500">
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Key>↑</Key>
            <Key>↓</Key> to move
          </span>
          <span className="inline-flex items-center gap-1">
            <Key>↵</Key> {selected ? openVerb(selected) : "open"}
          </span>
          {selected && revealVerb(selected) && (
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Key>{mod}</Key>
              <Key>↵</Key> {revealVerb(selected)}
            </span>
          )}
          {selected && removable(selected) && !query && (
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Key>Del</Key> remove
            </span>
          )}
          <span className="hidden items-center gap-1 lg:inline-flex">
            <Key>Tab</Key> next section
          </span>
          <span className="ml-auto hidden items-center gap-1 sm:inline-flex">
            <Key>&gt;</Key> actions
            <span className="mx-1 text-ink-300">·</span>
            <Key>@</Key> people
            <span className="mx-1 text-ink-300">·</span>
            <Key>esc</Key> {query ? "clear" : "close"}
          </span>
        </footer>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border border-ink-900/10 bg-white px-1 font-sans text-[10px] font-semibold text-ink-600 shadow-[0_1px_0_rgba(15,23,42,0.08)]">
      {children}
    </kbd>
  );
}

function openVerb(hit: Hit) {
  switch (hit.kind) {
    case "ticket":
    case "message":
      return "open ticket";
    case "person":
      return "view profile";
    case "department":
      return hit.item.canOpen ? "open department" : "raise a ticket";
    case "file":
      return hit.item.type === "link" ? "open link" : "open file";
    case "filter":
    case "query":
      return "apply";
    case "more":
      return "show all";
    default:
      return "open";
  }
}

function revealVerb(hit: Hit) {
  switch (hit.kind) {
    case "ticket":
    case "message":
      return "show in list";
    case "person":
      return "their tickets";
    case "department":
      return "its tickets";
    case "file":
      return "open ticket";
    default:
      return null;
  }
}

/* ---------------------------------------------------------------------- row */

/**
 * One result. Drawn again only when its own props change - the highlight
 * moving redraws the two rows it left and reached, nothing else.
 */
const HitRow = memo(function HitRow({
  hit,
  index,
  top,
  selected,
  words,
  removable,
  onHover,
  onRun,
  onRemove,
}: {
  hit: Hit;
  /** Its place in the whole list: rows arriving together come in one after another. */
  index: number;
  top: boolean;
  selected: boolean;
  words: string[];
  /** The reader's own history - a recent search or a recently opened item - which they may remove. */
  removable: boolean;
  onHover: (key: string) => void;
  onRun: (hit: Hit, mode: Mode) => void;
  onRemove: (hit: Hit) => void;
}) {
  let glyph: React.ReactNode;
  let title: React.ReactNode;
  let sub: React.ReactNode = null;
  let trailing: React.ReactNode = null;

  switch (hit.kind) {
    case "ticket": {
      const ticket = hit.item;
      glyph = (
        <Glyph kind="ticket" className={top ? "size-10 rounded-xl" : undefined}>
          <Ticket className={top ? "size-5" : "size-3.5"} />
        </Glyph>
      );
      title = <Highlight text={ticket.subject} words={words} />;
      sub = ticket.match ? (
        <>
          <span className="font-semibold">{ticket.match.field === "conversation" ? "Said" : ticket.match.field === "attachment" ? "File" : "Description"}:</span>{" "}
          <Highlight text={ticket.match.text} words={words} />
        </>
      ) : (
        [ticket.departments.map((department) => department.name).join(", "), ticket.raisedBy.name && `by ${ticket.raisedBy.name}`]
          .filter(Boolean)
          .join(" · ")
      );
      trailing = (
        <>
          <span className={cn("text-[11px] font-bold tabular-nums", selected ? "text-white/85" : "text-ink-500")}>
            <Highlight text={ticket.number} words={words} />
          </span>
          <StatusPill status={ticket.status} className={cn(selected && "ring-1 ring-white/40")} />
        </>
      );
      break;
    }
    case "person": {
      const person = hit.item;
      glyph = (
        <Avatar
          initials={initials(person.name)}
          tone={person.departments.some((item) => item.role === "head") || person.role !== "user" ? "head" : "team"}
          className={top ? "size-10 text-sm" : "size-7 text-[10px]"}
        />
      );
      title = <Highlight text={person.name} words={words} />;
      sub = [person.designation, person.departments.map((item) => item.name).join(", ")].filter(Boolean).join(" · ") || person.email;
      break;
    }
    case "department": {
      const department = hit.item;
      glyph = (
        <Glyph kind="department" className={top ? "size-10 rounded-xl" : undefined}>
          <Users className={top ? "size-5" : "size-3.5"} />
        </Glyph>
      );
      title = <Highlight text={department.name} words={words} />;
      sub = [department.unit?.name, `${department.members} members`].filter(Boolean).join(" · ");
      trailing = department.myRole ? (
        <span className={cn("text-[11px] font-semibold", selected ? "text-white/85" : "text-ink-400")}>
          {department.myRole === "head" ? "You run it" : "Member"}
        </span>
      ) : null;
      break;
    }
    case "unit":
      glyph = (
        <Glyph kind="unit">
          <Building className="size-3.5" />
        </Glyph>
      );
      title = <Highlight text={hit.item.name} words={words} />;
      sub = `Unit · ${hit.item.departments} departments`;
      break;
    case "file": {
      const item = hit.item;
      const Icon = FILE_ICON[item.type];
      glyph =
        item.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived S3 links
          <img
            src={item.url}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            decoding="async"
            className="size-7 shrink-0 rounded-lg border border-ink-900/10 object-cover"
          />
        ) : (
          <Glyph kind={item.type}>
            <Icon className="size-3.5" />
          </Glyph>
        );
      title = (
        <Highlight
          text={item.type === "link" ? item.url.replace(/^https?:\/\//, "") : item.filename || "Untitled file"}
          words={words}
        />
      );
      sub = `${item.ticket.number} · ${item.by.name}${item.type !== "link" && item.size ? ` · ${fileSize(item.size)}` : ""}`;
      trailing = (
        <span className={cn("text-[11px]", selected ? "text-white/75" : "text-ink-400")}>{when(item.createdAt)}</span>
      );
      break;
    }
    case "message": {
      const message = hit.item;
      glyph = <Avatar initials={initials(message.author.name)} tone="team" className="size-7 text-[10px]" />;
      title = <Highlight text={message.body} words={words} />;
      sub = `${message.author.name} on ${message.ticket.number} · ${message.ticket.subject}`;
      trailing = (
        <span className={cn("text-[11px]", selected ? "text-white/75" : "text-ink-400")}>{when(message.createdAt)}</span>
      );
      break;
    }
    case "action": {
      const Icon = hit.item.icon;
      glyph = (
        <Glyph kind="action" className={top ? "size-10 rounded-xl" : undefined}>
          <Icon className={top ? "size-5" : "size-3.5"} />
        </Glyph>
      );
      title = <Highlight text={hit.item.label} words={words} />;
      sub = hit.item.hint;
      trailing = (
        <kbd
          className={cn(
            "rounded-md border px-1.5 py-px font-sans text-[10px] font-bold",
            selected ? "border-white/30 text-white/85" : "border-ink-900/10 bg-white text-ink-500",
          )}
        >
          {hit.item.quickKey}
        </kbd>
      );
      break;
    }
    case "filter":
      glyph = (
        <Glyph kind="filter">
          <ListFilter className="size-3.5" />
        </Glyph>
      );
      title = (
        <span>
          <span className="font-bold">{hit.filter}:</span>
          {hit.value}
        </span>
      );
      sub = hit.label;
      trailing = <span className={cn("text-[11px]", selected ? "text-white/75" : "text-ink-400")}>Tab</span>;
      break;
    case "query":
      glyph = (
        <Glyph kind={hit.icon === "recent" ? "recent" : "filter"}>
          {hit.icon === "recent" ? <Clock className="size-3.5" /> : <ListFilter className="size-3.5" />}
        </Glyph>
      );
      title = hit.label;
      sub = hit.icon === "filter" && !hit.label.includes(":") ? hit.query.trim() : null;
      break;
    case "recent": {
      const item = hit.item;
      const Icon = { ticket: Ticket, person: Users, department: Users, unit: Building }[item.kind];
      glyph = (
        <Glyph kind="recent">
          <Icon className="size-3.5" />
        </Glyph>
      );
      title = item.title;
      sub = item.subtitle;
      break;
    }
    case "more":
      glyph = (
        <Glyph kind="more">
          <ArrowRight className="size-3.5" />
        </Glyph>
      );
      title = hit.label;
      break;
  }

  return (
    <div
      id={`hit-${hit.key}`}
      data-hit={hit.key}
      role="option"
      aria-selected={selected}
      onMouseMove={selected ? undefined : () => onHover(hit.key)}
      onClick={(event) => onRun(hit, event.metaKey || event.ctrlKey ? "reveal" : event.altKey ? "alt" : "open")}
      style={{ animationDelay: `${Math.min(index, 10) * 14}ms` }}
      className={cn(
        "sl-row group relative flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 transition-colors duration-150",
        top ? "py-2" : "py-1.5",
        // The highlight itself slides beneath; the row only turns its text white.
        selected ? "text-white" : "text-ink-800",
      )}
    >
      {glyph}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", top ? "text-[14px] font-semibold" : "text-[13px] font-medium")}>{title}</span>
        {sub && (
          <span className={cn("block truncate text-[11px]", selected ? "text-white/75" : "text-ink-500")}>{sub}</span>
        )}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
      {removable && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(hit);
          }}
          aria-label={`Remove “${hit.kind === "recent" ? hit.item.title : hit.kind === "query" ? hit.label : ""}” from recents`}
          title="Remove (Del)"
          className={cn(
            "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md transition-[opacity,background-color]",
            selected
              ? "text-white/80 opacity-100 hover:bg-white/20 hover:text-white"
              : "text-ink-400 opacity-0 group-hover:opacity-100 hover:bg-ink-900/[0.07] hover:text-ink-700 focus-visible:opacity-100",
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ preview */

function Preview({
  hit,
  mod,
  onRun,
  onCopy,
  ticketLink,
  onAsk,
}: {
  hit: Hit | null;
  mod: string;
  onRun: (mode: Mode) => void;
  onCopy: (text: string, what: string) => void;
  ticketLink: (ticket: { id: string; raisedById: string }) => string;
  onAsk: (query: string, scope?: Scope) => void;
}) {
  if (!hit || hit.kind === "filter" || hit.kind === "query" || hit.kind === "more" || hit.kind === "recent") {
    return <Tips onAsk={onAsk} />;
  }

  switch (hit.kind) {
    case "ticket":
      return (
        <TicketPreview
          ticket={hit.item}
          actions={
            <>
              <PreviewButton primary icon={ExternalLink} label="Open" keys="↵" onClick={() => onRun("open")} />
              <PreviewButton icon={MessageSquareText} label="Chat" keys="Alt ↵" onClick={() => onRun("alt")} />
              <PreviewButton icon={ListFilter} label="Show in list" keys={`${mod} ↵`} onClick={() => onRun("reveal")} />
              <PreviewButton
                icon={Copy}
                label="Copy link"
                onClick={() => onCopy(ticketLink({ id: hit.item.id, raisedById: hit.item.raisedBy.id }), "Link")}
              />
            </>
          }
        />
      );
    case "person":
      return (
        <PersonPreview
          person={hit.item}
          actions={
            <>
              <PreviewButton primary icon={Users} label="Profile" keys="↵" onClick={() => onRun("open")} />
              <PreviewButton icon={Ticket} label="Their tickets" keys={`${mod} ↵`} onClick={() => onRun("reveal")} />
              <PreviewButton icon={Mail} label="Email" href={`mailto:${hit.item.email}`} />
              {hit.item.phone && <PreviewButton icon={Phone} label="Call" href={`tel:${hit.item.phone}`} />}
            </>
          }
        />
      );
    case "department":
      return (
        <DepartmentPreview
          department={hit.item}
          actions={
            <>
              <PreviewButton
                primary
                icon={ExternalLink}
                label={hit.item.canOpen ? "Open" : "Raise a ticket"}
                keys="↵"
                onClick={() => onRun("open")}
              />
              <PreviewButton icon={Ticket} label="Its tickets" keys={`${mod} ↵`} onClick={() => onRun("reveal")} />
            </>
          }
        />
      );
    case "unit":
      return (
        <UnitPreview
          unit={hit.item}
          actions={<PreviewButton primary icon={ExternalLink} label="Open" keys="↵" onClick={() => onRun("open")} />}
        />
      );
    case "file":
      return (
        <FilePreview
          item={hit.item}
          actions={
            <>
              <PreviewButton primary icon={ExternalLink} label="Open" keys="↵" onClick={() => onRun("open")} />
              {hit.item.type !== "link" && (
                <PreviewButton icon={Download} label="Download" keys="Alt ↵" onClick={() => onRun("alt")} />
              )}
              <PreviewButton icon={Ticket} label="Ticket" keys={`${mod} ↵`} onClick={() => onRun("reveal")} />
            </>
          }
        />
      );
    case "message":
      return (
        <MessagePreview
          message={hit.item}
          actions={
            <PreviewButton primary icon={MessageSquareText} label="Open conversation" keys="↵" onClick={() => onRun("open")} />
          }
        />
      );
    case "action":
      return <ActionPreview action={hit.item} onRun={() => onRun("open")} />;
  }
}

/** With nothing chosen: what the box understands, each one a click to try. */
function Tips({ onAsk }: { onAsk: (query: string, scope?: Scope) => void }) {
  return (
    <div className="px-4 py-4">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink-800">
        <Sparkles className="size-3.5 text-amber-500" />
        Search smarter
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
        Type a ticket number like <b className="text-ink-700">21</b>, a name, a file, or words from a conversation. Add a filter to narrow it:
      </p>
      <ul className="mt-3 space-y-1">
        {FILTER_HELP.map((help) => (
          <li key={help.key}>
            <button
              type="button"
              onClick={() => onAsk(`${help.key}:`)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-900/[0.05]"
            >
              <code className="text-[11px] font-bold text-ink-800">{help.example}</code>
              <span className="truncate text-[11px] text-ink-500">{help.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-1 border-t border-ink-900/[0.07] pt-3 text-[11px] text-ink-500">
        <p>
          <b className="text-ink-700">&gt;</b> at the start lists actions · <b className="text-ink-700">@</b> searches people
        </p>
        <p>
          <b className="text-ink-700">Alt 1-7</b> switches what you search in
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ trigger */

/**
 * The box in the header. Not a field itself - pressing it opens the search,
 * which is where typing happens - but it looks like one, says what it finds,
 * and shows the key that opens it from anywhere.
 */
export function SpotlightTrigger() {
  const { open } = useSpotlight();
  const mod = useModKey();

  return (
    <button
      type="button"
      onClick={() => open()}
      aria-label="Search"
      aria-keyshortcuts="Control+Space Alt+Space Control+K Meta+K"
      className={cn(
        "group inline-flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-ink-50/80 text-ink-400 transition-colors",
        "hover:border-line-strong hover:bg-surface hover:text-ink-600",
        "w-7 justify-center sm:w-56 sm:justify-start sm:pr-1.5 sm:pl-2.5 lg:w-72",
      )}
    >
      <Search className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span className="hidden flex-1 truncate text-left text-[12px] sm:block">Search tickets, people, files…</span>
      {/* New, and still being shaped by how people use it. */}
      <span className="hidden shrink-0 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-1.5 py-px text-[9px] leading-[14px] font-bold tracking-wide text-white uppercase shadow-sm shadow-fuchsia-500/30 sm:inline-block">
        Beta
      </span>
      <kbd className="hidden h-[18px] items-center gap-0.5 rounded-[5px] border border-line bg-surface px-1.5 font-sans text-[10px] font-semibold text-ink-500 shadow-[0_1px_0_rgba(15,23,42,0.06)] sm:inline-flex">
        {mod === "⌘" ? "⌥" : "Ctrl"} Space
      </kbd>
    </button>
  );
}
