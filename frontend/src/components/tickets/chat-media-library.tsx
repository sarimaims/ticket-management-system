"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Film, Link2, Search, X } from "lucide-react";

import { DocumentIcon, extensionOf, PhotoLightbox } from "@/components/tickets/chat-attachments";
import { errorMessage } from "@/lib/api";
import { listMedia, type SharedFile, type SharedLink } from "@/lib/messages";
import { formatBytes } from "@/lib/uploads";
import { cn, formatDateOf } from "@/lib/utils";

type Tab = "media" | "documents" | "links";

const TABS: { key: Tab; label: string }[] = [
  { key: "media", label: "Media" },
  { key: "documents", label: "Docs" },
  { key: "links", label: "Links" },
];

/** How long typing has to pause before the search goes to the server. */
const SEARCH_DELAY_MS = 250;

/** "18 Sep 2026" as a heading, the way a phone groups a gallery by month. */
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

/**
 * Everything the thread has shared, in one place: its photos and videos, its
 * documents, and its links - the "Media, links and docs" page of a messaging
 * app.
 *
 * The request's own attachments are here too, marked as such, because the
 * paperwork a ticket was raised with is part of what was shared about it.
 *
 * The search runs on the server against the name each file was sent with, one
 * word at a time, so "digital salary" finds "aims-digital-salary-list.xlsx".
 */
export function ChatMediaLibrary({
  ticketId,
  onClose,
}: {
  ticketId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("media");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState("");
  const [data, setData] = useState<{
    media: SharedFile[];
    documents: SharedFile[];
    links: SharedLink[];
  } | null>(null);
  const [error, setError] = useState("");
  /** Which photo is open, as its place among the photos - so the arrows can step. */
  const [viewing, setViewing] = useState<number | null>(null);

  // A beat after typing stops, rather than a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearching(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    listMedia(ticketId, searching, controller.signal)
      .then((answer) => {
        setData(answer);
        setError("");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      });
    return () => controller.abort();
  }, [ticketId, searching]);

  const counts = {
    media: data?.media.length ?? 0,
    documents: data?.documents.length ?? 0,
    links: data?.links.length ?? 0,
  };

  const mediaGroups = useMemo(() => byMonth(data?.media ?? []), [data]);
  // Only photos open in the viewer; a video plays in its own tab instead.
  const photos = useMemo(() => (data?.media ?? []).filter((item) => item.kind === "image"), [data]);
  const documentGroups = useMemo(() => byMonth(data?.documents ?? []), [data]);
  const linkGroups = useMemo(() => byMonth(data?.links ?? []), [data]);

  const empty =
    data !== null &&
    ((tab === "media" && counts.media === 0) ||
      (tab === "documents" && counts.documents === 0) ||
      (tab === "links" && counts.links === 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
        >
          <ArrowLeft className="size-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink-900">
          Media, docs and links
        </p>
      </div>

      <div className="relative border-b border-line">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by file name"
          aria-label="Search shared files by name"
          className="h-9 w-full bg-transparent pr-8 pl-8 text-[12.5px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear the search"
            className="absolute top-1/2 right-2.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-3" strokeWidth={3} />
          </button>
        )}
      </div>

      <div className="flex border-b border-line">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            aria-pressed={tab === entry.key}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-[12px] font-semibold transition-colors",
              tab === entry.key
                ? "border-chat-accent text-chat-accent-strong"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {entry.label}
            <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500 tabular-nums">
              {counts[entry.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {error && (
          <p role="alert" className="py-6 text-center text-[12px] text-brand-600">
            {error}
          </p>
        )}

        {data === null && !error && (
          <div className="grid grid-cols-3 gap-1 pt-2">
            {Array.from({ length: 9 }).map((_, index) => (
              <span key={index} className="aspect-square animate-pulse rounded-md bg-ink-100" />
            ))}
          </div>
        )}

        {empty && (
          <p className="py-10 text-center text-[12px] text-ink-400">
            {searching
              ? `Nothing named like “${searching}”.`
              : tab === "media"
                ? "No photos or videos shared yet."
                : tab === "documents"
                  ? "No documents shared yet."
                  : "No links shared yet."}
          </p>
        )}

        {/* Media: a grid of thumbnails, grouped by month. */}
        {tab === "media" &&
          mediaGroups.map((group) => (
            <section key={group.label} className="mb-3">
              <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
                {group.label}
              </h3>
              <div className="grid grid-cols-3 gap-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      item.kind === "image"
                        ? setViewing(photos.findIndex((photo) => photo.id === item.id))
                        : window.open(item.url, "_blank", "noopener")
                    }
                    title={item.filename}
                    className="group relative aspect-square overflow-hidden rounded-md bg-ink-100"
                  >
                    {item.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL
                      <img
                        src={item.url}
                        alt={item.filename || "Photo"}
                        loading="lazy"
                        className="size-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <>
                        <video
                          src={item.url}
                          muted
                          preload="metadata"
                          className="size-full object-cover"
                        />
                        <Film className="absolute right-1 bottom-1 size-4 text-white drop-shadow" />
                      </>
                    )}
                    {item.from === "request" && (
                      <span className="absolute top-1 left-1 rounded bg-ink-900/60 px-1 text-[9px] font-semibold text-white">
                        Request
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}

        {/* Documents: a list, because a document is recognised by its name. */}
        {tab === "documents" &&
          documentGroups.map((group) => (
            <section key={group.label} className="mb-3">
              <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
                {group.label}
              </h3>
              <ul className="divide-y divide-line">
                {group.items.map((item) => {
                  return (
                    <li key={item.id}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 rounded-md px-1 py-2 transition-colors hover:bg-ink-50"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-chat-accent-soft text-chat-accent-strong">
                          <DocumentIcon
                            mimeType={item.mimeType}
                            filename={item.filename}
                            className="size-4.5"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-ink-900">
                            {item.filename || "Document"}
                          </span>
                          <span className="block truncate text-[11px] text-ink-400">
                            {extensionOf(item.filename)} · {formatBytes(item.size)} ·{" "}
                            {item.by.name} · {formatDateOf(item.createdAt)}
                            {item.from === "request" && " · with the request"}
                          </span>
                        </span>
                        <Download className="size-4 shrink-0 text-ink-400" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

        {/* Links: the domain first, then the line it was posted in. */}
        {tab === "links" &&
          linkGroups.map((group) => (
            <section key={group.label} className="mb-3">
              <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
                {group.label}
              </h3>
              <ul className="divide-y divide-line">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2.5 rounded-md px-1 py-2 transition-colors hover:bg-ink-50"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-status-progress-bg text-status-progress-fg">
                        <Link2 className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-ink-900">
                          {hostOf(item.url)}
                        </span>
                        <span className="block truncate text-[11px] text-status-progress-fg">
                          {item.url}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11px] text-ink-500">
                          {item.context}
                        </span>
                        <span className="block text-[10px] text-ink-400">
                          {item.by.name} · {formatDateOf(item.createdAt)}
                        </span>
                      </span>
                      <ExternalLink className="mt-1 size-3.5 shrink-0 text-ink-400" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      {viewing !== null && photos[viewing] && (
        <PhotoLightbox
          src={photos[viewing].url}
          alt={photos[viewing].filename || "Photo"}
          onClose={() => setViewing(null)}
          onPrev={
            photos.length > 1
              ? () => setViewing((current) => ((current ?? 0) - 1 + photos.length) % photos.length)
              : undefined
          }
          onNext={
            photos.length > 1
              ? () => setViewing((current) => ((current ?? 0) + 1) % photos.length)
              : undefined
          }
          position={photos.length > 1 ? `${viewing + 1} / ${photos.length}` : undefined}
        />
      )}
    </div>
  );
}
