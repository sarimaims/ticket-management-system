"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  Film,
  FolderOpen,
  ImageIcon,
  LayoutGrid,
  Link2,
  Loader2,
  Play,
  Search,
  SearchX,
  X,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { DocumentIcon, extensionOf, PhotoLightbox } from "@/components/tickets/chat-attachments";
import { errorMessage } from "@/lib/api";
import { canSeeAllTickets } from "@/lib/auth";
import {
  listLibrary,
  type Library,
  type LibraryFile,
  type LibraryItem,
  type LibraryLink,
  type LibraryTicket,
  type LibraryType,
} from "@/lib/library";
import { formatBytes } from "@/lib/uploads";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

type Shelf = "all" | LibraryType;

const SHELVES: { key: Shelf; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "image", label: "Images", icon: ImageIcon },
  { key: "video", label: "Videos", icon: Film },
  { key: "document", label: "Documents", icon: FileText },
  { key: "link", label: "Links", icon: Link2 },
];

/** How long typing has to pause before the search goes to the server. */
const SEARCH_DELAY_MS = 250;

/** How much of each shelf the overview shows before "View all". */
const PREVIEW = { image: 16, video: 8, document: 6, link: 6 } as const;

/** "September 2026", the way a phone groups a gallery. */
const monthOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });

function byMonth<T extends { createdAt: string }>(items: T[]) {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = monthOf(item.createdAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** Where a link goes, as the domain rather than the whole address. */
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A tint per kind of document, so a list of them can be scanned by type. */
function documentTone(filename: string, mimeType: string) {
  const name = filename.toLowerCase();
  if (/pdf/.test(mimeType) || name.endsWith(".pdf")) return "bg-red-50 text-red-600";
  if (/sheet|excel|csv/.test(mimeType) || /\.(xlsx?|ods|csv)$/.test(name))
    return "bg-emerald-50 text-emerald-600";
  if (/word|document/.test(mimeType) || /\.(docx?|odt|rtf)$/.test(name))
    return "bg-blue-50 text-blue-600";
  if (/presentation|powerpoint/.test(mimeType) || /\.(pptx?|odp)$/.test(name))
    return "bg-orange-50 text-orange-600";
  if (/zip|compressed|rar|7z/.test(mimeType) || /\.(zip|rar|7z)$/.test(name))
    return "bg-amber-50 text-amber-600";
  return "bg-ink-100 text-ink-500";
}

/* ------------------------------------------------------------------ bits */

/**
 * The ticket an item came from, as a chip that opens it.
 *
 * Opened on the list the reader would find it on: their own requests, the
 * queue they oversee, or what is on their desk - with the sheet already open,
 * so the click ends on the ticket rather than on a list to look through.
 */
function TicketChip({
  ticket,
  href,
  className,
}: {
  ticket: LibraryTicket;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href as "/"}
      onClick={(event) => event.stopPropagation()}
      title={`Open ${ticket.number} · ${ticket.subject}`}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] transition-colors hover:border-brand-300 hover:bg-brand-50",
        className,
      )}
    >
      <span className="shrink-0 font-bold text-brand-600">{ticket.number}</span>
      <span className="min-w-0 truncate text-ink-600">{ticket.subject}</span>
    </Link>
  );
}

/** A heading for a stretch of the library, with a way to see all of it. */
function SectionHead({
  icon: Icon,
  title,
  count,
  onMore,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  onMore?: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="size-3.5 text-ink-400" />
      <h2 className="text-[12px] font-bold text-ink-800">{title}</h2>
      <span className="rounded bg-ink-100 px-1.5 text-[10px] font-semibold text-ink-500 tabular-nums">
        {count}
      </span>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700"
        >
          View all
          <ArrowRight className="size-3" />
        </button>
      )}
    </div>
  );
}

/** A month's heading inside one shelf. */
function MonthHead({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
      {label}
      <span className="h-px flex-1 bg-line" />
      <span className="tracking-normal normal-case tabular-nums">{count}</span>
    </h3>
  );
}

/** One photo or video in a grid: the picture, its ticket, and on hover its name. */
function MediaTile({
  item,
  href,
  onOpen,
}: {
  item: LibraryFile;
  href: string;
  onOpen: () => void;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-ink-100">
      <button
        type="button"
        onClick={onOpen}
        title={item.filename}
        aria-label={`Open ${item.filename || (item.type === "video" ? "video" : "photo")}`}
        className="absolute inset-0 cursor-zoom-in"
      >
        {item.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL
          <img
            src={item.url}
            alt={item.filename || "Photo"}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <>
            <video src={item.url} muted preload="metadata" className="size-full object-cover" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-9 place-items-center rounded-full bg-ink-900/60 text-white backdrop-blur-sm">
                <Play className="ml-0.5 size-4 fill-current" />
              </span>
            </span>
          </>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900/85 via-ink-900/40 to-transparent px-1.5 pt-6 pb-1.5 text-left opacity-0 transition-opacity group-hover:opacity-100">
          <span className="block truncate text-[11px] font-semibold text-white">
            {item.filename || "Untitled"}
          </span>
          <span className="block truncate text-[10px] text-white/80">
            {item.by.name} · {formatDateOf(item.createdAt)}
            {item.from === "request" && " · with the request"}
          </span>
        </span>
      </button>

      {/* Always showing: which ticket it belongs to is half of finding it. */}
      <Link
        href={href as "/"}
        title={`Open ${item.ticket.number} · ${item.ticket.subject}`}
        className="absolute top-1 left-1 rounded bg-surface/90 px-1 py-px text-[9.5px] font-bold text-brand-600 shadow-sm backdrop-blur-sm transition-colors hover:bg-surface"
      >
        {item.ticket.number}
      </Link>
    </div>
  );
}

/** One document: what it is called, what it is, where it came from. */
function DocumentRow({ item, href }: { item: LibraryFile; href: string }) {
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-ink-50/70">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          documentTone(item.filename, item.mimeType),
        )}
      >
        <DocumentIcon mimeType={item.mimeType} filename={item.filename} className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-[13px] font-semibold text-ink-900 hover:text-brand-600"
        >
          {item.filename || "Document"}
        </a>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-400">
          <span className="font-semibold text-ink-500">{extensionOf(item.filename)}</span>
          <span>·</span>
          <span>{formatBytes(item.size)}</span>
          <span>·</span>
          <span>{item.by.name}</span>
          <span>·</span>
          <span>
            {formatDateOf(item.createdAt)} {formatTime(item.createdAt)}
          </span>
          {item.from === "request" && (
            <span className="rounded bg-ink-100 px-1 text-[10px] font-semibold text-ink-500">
              With the request
            </span>
          )}
        </p>
      </div>

      <TicketChip ticket={item.ticket} href={href} className="hidden max-w-[16rem] md:inline-flex" />

      <span className="flex shrink-0 items-center gap-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title="Open"
          aria-label={`Open ${item.filename}`}
          className="grid size-8 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <ExternalLink className="size-4" />
        </a>
        <a
          href={item.downloadUrl}
          title="Download"
          aria-label={`Download ${item.filename}`}
          className="grid size-8 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
        >
          <Download className="size-4" />
        </a>
      </span>
    </li>
  );
}

/** One link: the site, the address, and the sentence it was posted in. */
function LinkRow({ item, href }: { item: LibraryLink; href: string }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-ink-50/70">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-status-progress-bg text-status-progress-fg">
        <Link2 className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group/link flex min-w-0 items-baseline gap-1.5"
        >
          <span className="shrink-0 text-[13px] font-semibold text-ink-900 group-hover/link:text-brand-600">
            {hostOf(item.url)}
          </span>
          <span className="min-w-0 truncate text-[11px] text-status-progress-fg">{item.url}</span>
        </a>
        {item.context && item.context.trim() !== item.url && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-600">
            “{item.context}”
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-400">
          <span>{item.by.name}</span>
          <span>·</span>
          <span>
            {formatDateOf(item.createdAt)} {formatTime(item.createdAt)}
          </span>
          {item.from === "request" && (
            <span className="rounded bg-ink-100 px-1 text-[10px] font-semibold text-ink-500">
              In the request
            </span>
          )}
          <TicketChip ticket={item.ticket} href={href} className="md:hidden" />
        </p>
      </div>

      <TicketChip ticket={item.ticket} href={href} className="hidden max-w-[16rem] md:inline-flex" />

      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${item.url}`}
        className="grid size-8 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
      >
        <ExternalLink className="size-4" />
      </a>
    </li>
  );
}

/** A video, played over the page. */
function VideoViewer({
  item,
  href,
  onClose,
}: {
  item: LibraryFile;
  href: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.filename || "Video"}
      onClick={onClose}
      className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/85 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-ink-900/60 text-white hover:bg-ink-900"
      >
        <X className="size-5" />
      </button>
      <div onClick={(event) => event.stopPropagation()} className="flex max-w-full flex-col items-center gap-3">
        <video
          src={item.url}
          controls
          autoPlay
          className="max-h-[78vh] max-w-full rounded-lg bg-black shadow-2xl"
        />
        <ViewerFooter item={item} href={href} />
      </div>
    </div>
  );
}

/** Under a photo or video: what it is and where it came from, with its actions. */
function ViewerFooter({ item, href }: { item: LibraryFile; href: string }) {
  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full bg-ink-900/70 py-1.5 pr-1.5 pl-3 text-white backdrop-blur-sm">
      <span className="min-w-0 truncate text-[12px] font-semibold">{item.filename || "Untitled"}</span>
      <span className="text-[11px] text-white/70">
        {item.by.name} · {formatDateOf(item.createdAt)}
      </span>
      <Link
        href={href as "/"}
        className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/25"
      >
        {item.ticket.number}
        <ArrowRight className="size-3" />
      </Link>
      <a
        href={item.downloadUrl}
        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-ink-900 hover:bg-white/90"
      >
        <Download className="size-3" />
        Download
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * Every photo, video, document and link from every ticket the reader can
 * see, in one place - for when you remember the file but not the ticket.
 *
 * One search across all of it, matched word by word against the name, the
 * ticket's number and subject, the sender and the department. The overview
 * shows a little of each shelf; a shelf on its own shows everything on it,
 * grouped by month. Every item carries the ticket it came from, one click
 * away.
 */
export function AttachmentsLibrary() {
  const { session } = useAuth();
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState("");
  const [data, setData] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** The photo open in the viewer, as its place among the photos. */
  const [viewing, setViewing] = useState<number | null>(null);
  const [playing, setPlaying] = useState<LibraryFile | null>(null);

  // A beat after typing stops, rather than a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearching(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    listLibrary(searching, controller.signal)
      .then((answer) => {
        setData(answer);
        setError("");
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
        setLoading(false);
      });
    return () => controller.abort();
  }, [searching]);

  /** Still typing, or the answer for what was typed has not come back yet. */
  const busy = query.trim() !== searching || (loading && data !== null);

  const shelves = useMemo(() => {
    const items = data?.items ?? [];
    return {
      image: items.filter((item): item is LibraryFile => item.type === "image"),
      video: items.filter((item): item is LibraryFile => item.type === "video"),
      document: items.filter((item): item is LibraryFile => item.type === "document"),
      link: items.filter((item): item is LibraryLink => item.type === "link"),
    };
  }, [data]);

  const counts = data?.counts ?? { image: 0, video: 0, document: 0, link: 0 };
  const total = counts.image + counts.video + counts.document + counts.link;

  const meId = session?.id;
  const overseer = canSeeAllTickets(session);
  /** The list the reader would find this ticket on, with its sheet open. */
  const hrefFor = (ticket: LibraryTicket) => {
    const page =
      ticket.raisedById === meId ? "/my-requests" : overseer ? "/all-tickets" : "/assigned-to-me";
    return `${page}?ticket=${ticket.id}&open=1`;
  };

  const openMedia = (item: LibraryFile) => {
    if (item.type === "video") setPlaying(item);
    else setViewing(shelves.image.findIndex((photo) => photo.id === item.id));
  };

  const photo = viewing !== null ? shelves.image[viewing] : null;

  const mediaGrid = (items: LibraryFile[]) => (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
      {items.map((item) => (
        <MediaTile key={item.id} item={item} href={hrefFor(item.ticket)} onOpen={() => openMedia(item)} />
      ))}
    </div>
  );

  const documentList = (items: LibraryFile[]) => (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {items.map((item) => (
        <DocumentRow key={item.id} item={item} href={hrefFor(item.ticket)} />
      ))}
    </ul>
  );

  const linkList = (items: LibraryLink[]) => (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {items.map((item) => (
        <LinkRow key={item.id} item={item} href={hrefFor(item.ticket)} />
      ))}
    </ul>
  );

  /** Everything on one shelf, month by month. */
  const byMonthOf = <T extends LibraryItem>(items: T[], render: (items: T[]) => React.ReactNode) =>
    byMonth(items).map((group) => (
      <section key={group.label} className="mb-4">
        <MonthHead label={group.label} count={group.items.length} />
        {render(group.items)}
      </section>
    ));

  const shelfEmpty = shelf !== "all" && data !== null && counts[shelf] === 0;

  return (
    <div className="space-y-3">
      {/* Search and shelves: one bar, because they are one question. */}
      <div className="rounded-xl border border-line bg-surface p-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            {busy ? (
              <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-brand-500" />
            ) : (
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by file name, ticket number, subject, sender or link…"
              aria-label="Search attachments"
              className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-9 pl-9 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the search"
                className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div role="tablist" aria-label="What to show" className="flex gap-0.5 overflow-x-auto rounded-lg bg-ink-100/70 p-0.5">
            {SHELVES.map(({ key, label, icon: Icon }) => {
              const count = key === "all" ? total : counts[key];
              const active = shelf === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setShelf(key)}
                  className={cn(
                    "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition-all",
                    active
                      ? "bg-surface text-ink-900 shadow-sm"
                      : "text-ink-500 hover:text-ink-800",
                  )}
                >
                  <Icon className={cn("size-3.5", active ? "text-brand-600" : "text-ink-400")} />
                  {label}
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] tabular-nums",
                      active ? "bg-brand-50 text-brand-700" : "bg-ink-200/70 text-ink-500",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {data && (
          <p className="mt-1.5 px-1 text-[11px] text-ink-400">
            {searching ? (
              <>
                <span className="font-semibold text-ink-700">{total}</span> matching “
                <span className="font-semibold text-ink-700">{searching}</span>” across{" "}
                {data.tickets} {data.tickets === 1 ? "ticket" : "tickets"}
              </>
            ) : (
              <>
                <span className="font-semibold text-ink-700">{total}</span> shared across{" "}
                {data.tickets} {data.tickets === 1 ? "ticket" : "tickets"} you can see
              </>
            )}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
          {error}
        </p>
      )}

      {/* The shape of the page while it fills in, not a spinner where it will be. */}
      {loading && !data && !error && (
        <div className="space-y-3" aria-hidden>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {Array.from({ length: 10 }).map((_, index) => (
              <span key={index} className="aspect-square animate-pulse rounded-lg bg-ink-100" />
            ))}
          </div>
          <div className="space-y-px overflow-hidden rounded-lg border border-line">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 bg-surface px-3 py-2.5">
                <span className="size-10 animate-pulse rounded-lg bg-ink-100" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3 w-1/3 animate-pulse rounded bg-ink-100" />
                  <span className="block h-2.5 w-1/2 animate-pulse rounded bg-ink-100" />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={cn("transition-opacity", busy && data && "opacity-60")}>
        {/* Nothing at all, or nothing for this search: said differently. */}
        {data && total === 0 && (
          <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            {searching ? (
              <>
                <SearchX className="mx-auto size-7 text-ink-300" />
                <p className="mt-2 text-[14px] font-semibold text-ink-800">
                  Nothing matches “{searching}”
                </p>
                <p className="mt-1 text-[12px] text-ink-400">
                  Try a word from the file name, a ticket number like TK-0058, or a word from its
                  subject.
                </p>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1 rounded-md border border-line-strong px-2.5 py-1 text-[12px] font-semibold text-ink-700 hover:bg-ink-50"
                >
                  <X className="size-3.5" />
                  Clear search
                </button>
              </>
            ) : (
              <>
                <FolderOpen className="mx-auto size-7 text-ink-300" />
                <p className="mt-2 text-[14px] font-semibold text-ink-800">Nothing shared yet</p>
                <p className="mt-1 text-[12px] text-ink-400">
                  Photos, videos, documents and links from your tickets collect here as they are
                  shared.
                </p>
              </>
            )}
          </div>
        )}

        {data && total > 0 && shelfEmpty && (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center text-[12px] text-ink-400">
            No {SHELVES.find((entry) => entry.key === shelf)?.label.toLowerCase()}
            {searching ? ` matching “${searching}”` : " yet"}.
          </p>
        )}

        {/* The overview: a little of each shelf, and the way to the rest. */}
        {data && total > 0 && shelf === "all" && (
          <div className="space-y-5">
            {shelves.image.length > 0 && (
              <section>
                <SectionHead
                  icon={ImageIcon}
                  title="Images"
                  count={counts.image}
                  onMore={counts.image > PREVIEW.image ? () => setShelf("image") : undefined}
                />
                {mediaGrid(shelves.image.slice(0, PREVIEW.image))}
              </section>
            )}
            {shelves.video.length > 0 && (
              <section>
                <SectionHead
                  icon={Film}
                  title="Videos"
                  count={counts.video}
                  onMore={counts.video > PREVIEW.video ? () => setShelf("video") : undefined}
                />
                {mediaGrid(shelves.video.slice(0, PREVIEW.video))}
              </section>
            )}
            {shelves.document.length > 0 && (
              <section>
                <SectionHead
                  icon={FileText}
                  title="Documents"
                  count={counts.document}
                  onMore={counts.document > PREVIEW.document ? () => setShelf("document") : undefined}
                />
                {documentList(shelves.document.slice(0, PREVIEW.document))}
              </section>
            )}
            {shelves.link.length > 0 && (
              <section>
                <SectionHead
                  icon={Link2}
                  title="Links"
                  count={counts.link}
                  onMore={counts.link > PREVIEW.link ? () => setShelf("link") : undefined}
                />
                {linkList(shelves.link.slice(0, PREVIEW.link))}
              </section>
            )}
          </div>
        )}

        {/* One shelf, all of it, month by month. */}
        {data && shelf === "image" && byMonthOf(shelves.image, mediaGrid)}
        {data && shelf === "video" && byMonthOf(shelves.video, mediaGrid)}
        {data && shelf === "document" && byMonthOf(shelves.document, documentList)}
        {data && shelf === "link" && byMonthOf(shelves.link, linkList)}
      </div>

      {photo && viewing !== null && (
        <PhotoLightbox
          src={photo.url}
          alt={photo.filename || "Photo"}
          onClose={() => setViewing(null)}
          onPrev={
            shelves.image.length > 1
              ? () =>
                  setViewing(
                    (current) => ((current ?? 0) - 1 + shelves.image.length) % shelves.image.length,
                  )
              : undefined
          }
          onNext={
            shelves.image.length > 1
              ? () => setViewing((current) => ((current ?? 0) + 1) % shelves.image.length)
              : undefined
          }
          position={
            shelves.image.length > 1 ? `${viewing + 1} / ${shelves.image.length}` : undefined
          }
          footer={<ViewerFooter item={photo} href={hrefFor(photo.ticket)} />}
        />
      )}

      {playing && (
        <VideoViewer item={playing} href={hrefFor(playing.ticket)} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}
