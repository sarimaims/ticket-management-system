"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  CornerUpLeft,
  Eye,
  EyeOff,
  History,
  Image as ImageIcon,
  Info,
  Mic,
  Pencil,
  Ticket as TicketIcon,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { MessageAttachmentView } from "@/components/tickets/chat-attachments";
import { errorMessage } from "@/lib/api";
import {
  messageInfo,
  MAX_BODY,
  type MessageInfo,
  type MessageQuote,
  type MessageRecord,
} from "@/lib/messages";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

/** Roughly how tall the panel is, used to decide which way it opens. */
const PANEL_HEIGHT = 220;

/**
 * A colour per speaker, the way a group chat does it.
 *
 * Picked from the author's id rather than their position in the thread, so one
 * person keeps the same colour in every conversation and on every reload.
 */
const NAME_COLOURS = [
  "text-chat-accent-strong",
  "text-status-progress-fg",
  "text-status-completed-fg",
  "text-status-waiting-fg",
  "text-ink-600",
];

function nameColour(id: string) {
  let total = 0;
  for (let index = 0; index < id.length; index += 1) total += id.charCodeAt(index);
  return NAME_COLOURS[total % NAME_COLOURS.length];
}

/** What a quote says when the original was a photo or a voice note. */
function attachmentLabel(kind: MessageQuote["attachmentKind"]) {
  if (kind === "image") return "Photo";
  if (kind === "voice") return "Voice note";
  return "";
}

/**
 * The line being answered, above the answer.
 *
 * Clicking it walks back to the original, which is the only reason a quote is
 * worth showing rather than just re-reading the thread.
 */
function Quote({
  quote,
  mine,
  onJump,
}: {
  quote: MessageQuote;
  mine: boolean;
  onJump: (id: string) => void;
}) {
  const label = attachmentLabel(quote.attachmentKind);

  return (
    <button
      type="button"
      onClick={() => onJump(quote.id)}
      className={cn(
        "mb-1 flex w-full items-start gap-1 overflow-hidden rounded border-l-[3px] px-1.5 py-1 text-left transition-colors",
        mine
          ? "border-chat-accent bg-chat-mine-soft hover:brightness-95"
          : "border-chat-accent bg-ink-200/70 hover:bg-ink-200",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-bold text-chat-accent-strong">
          {quote.author.name}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 truncate text-[11px]",
            mine ? "text-chat-mine-meta" : "text-ink-500",
          )}
        >
          {quote.attachmentKind === "image" && <ImageIcon className="size-3 shrink-0" />}
          {quote.attachmentKind === "voice" && <Mic className="size-3 shrink-0" />}
          <span className="truncate italic">
            {quote.deleted ? "This message was deleted" : quote.body || label}
          </span>
        </span>
      </span>
    </button>
  );
}

/**
 * When one line was said, and who has had the thread open since.
 *
 * Small on purpose: it answers two questions and closes. "Seen" is stated as
 * what it is - the thread was open after this was written - rather than
 * dressed up as a read receipt.
 */
function InfoDialog({ message, onClose }: { message: MessageRecord; onClose: () => void }) {
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    messageInfo(message.ticket, message.id, controller.signal)
      .then(setInfo)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      });
    return () => controller.abort();
  }, [message.ticket, message.id]);

  useEffect(() => {
    // Captured, so the sheet behind this does not close with it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-ink-400">{label}</dt>
      <dd className="text-[11px] font-semibold text-ink-800">{value}</dd>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message info"
        className="relative w-full max-w-[17rem] rounded-xl border border-line bg-surface p-3 shadow-2xl shadow-ink-900/20"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-bold text-ink-900">Message info</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-5 place-items-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {error ? (
          <p className="mt-2 text-[11px] text-brand-600">{error}</p>
        ) : !info ? (
          <p className="mt-2 text-[11px] text-ink-400">Loading...</p>
        ) : (
          <>
            <dl className="mt-2 space-y-1 border-t border-line pt-2">
              {row("Sent", `${formatDateOf(info.sentAt)} · ${formatTime(info.sentAt)}`)}
              {info.editedAt &&
                row("Edited", `${formatDateOf(info.editedAt)} · ${formatTime(info.editedAt)}`)}
              {info.deletedAt &&
                row("Deleted", `${formatDateOf(info.deletedAt)} · ${formatTime(info.deletedAt)}`)}
            </dl>

            <p className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-[11px] font-bold text-ink-900">
              <Eye className="size-3.5 text-chat-accent" />
              {info.seenBy.length === 0
                ? "Nobody has seen it yet"
                : `Seen by ${info.seenBy.length} ${info.seenBy.length === 1 ? "person" : "people"}`}
            </p>

            {info.seenBy.length > 0 && (
              <ul className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
                {info.seenBy.map((reader) => (
                  <li
                    key={reader.id}
                    className="flex items-baseline justify-between gap-3 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-ink-700">{reader.name}</span>
                    <span className="shrink-0 text-ink-400">{formatTime(reader.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * What can be done with one message, and who said it.
 *
 * Everything that used to sit under the bubble as always-visible links lives
 * here instead: the thread reads as text, and the controls appear on the
 * message under the pointer. The lower half answers "who is this?" - the
 * department and unit the author belongs to, which is the thing you actually
 * want to know about a name you do not recognise.
 */
function MessageMenu({
  message,
  mine,
  manager,
  canEdit,
  showingHistory,
  onReply,
  onEdit,
  onDelete,
  onInfo,
  onToggleHistory,
  departmentName,
}: {
  message: MessageRecord;
  mine: boolean;
  manager: boolean;
  /** Your own line, still standing: the only kind that can be changed. */
  canEdit: boolean;
  showingHistory: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onInfo: () => void;
  onToggleHistory: () => void;
  departmentName: string;
}) {
  const [open, setOpen] = useState(false);
  /** Where the panel is pinned, in viewport coordinates. */
  const [at, setAt] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * The thread scrolls inside its own box, which would cut a menu drawn in
   * it - so the panel is drawn on the body and pinned to the caret instead,
   * above it when the message is near the bottom of the window.
   */
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;

    const room = window.innerHeight - rect.bottom;
    setAt({
      right: Math.max(8, window.innerWidth - rect.right),
      ...(room > PANEL_HEIGHT
        ? { top: rect.bottom + 4 }
        : { bottom: Math.max(8, window.innerHeight - rect.top + 4) }),
    });
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const inPanel = root.current?.contains(event.target as Node);
      const inPortal = (event.target as HTMLElement).closest?.("[data-message-menu]");
      if (!inPanel && !inPortal) setOpen(false);
    };
    // A menu pinned to a caret cannot follow it up the thread, so it closes
    // when the thread moves - but a window resize only moves the caret, so it
    // is re-pinned rather than shut.
    const onScroll = () => setOpen(false);
    const onResize = () => place();
    // Caught on the way down and stopped: the sheet this chat sits in also
    // closes on Escape, and one key press should shut one thing.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
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

  // An admin belongs to no department in particular and reads every one, so
  // an empty list means "all of them" rather than "none".
  const everywhere = message.authorRole === "admin" || message.authorRole === "superadmin";

  const units =
    message.authorUnits.length > 0
      ? message.authorUnits.map((unit) => unit.name).join(", ")
      : everywhere
        ? "Every unit"
        : "—";

  const departments =
    message.authorDepartments.length > 0
      ? message.authorDepartments
          .map((item) => (item.role === "head" ? `${item.name} (Head)` : item.name))
          .join(", ")
      : everywhere
        ? "Every department"
        : "—";

  const act = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-100";

  return (
    <div ref={root} className="absolute top-0.5 right-0.5 z-20">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          place();
          setOpen((current) => !current);
        }}
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "grid size-5 place-items-center rounded transition-opacity",
          // Out of the way until the pointer is on this message, and pinned
          // open while its menu is.
          open ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100 focus:opacity-100",
          mine ? "text-chat-mine-meta hover:bg-black/5" : "text-ink-400 hover:bg-ink-200",
        )}
      >
        <ChevronDown className="size-3.5" />
      </button>

      {open &&
        at &&
        createPortal(
        <div
          role="menu"
          data-message-menu
          style={{ right: at.right, top: at.top, bottom: at.bottom }}
          className="fixed z-50 w-60 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-ink-900/10"
        >
          <button type="button" role="menuitem" className={item} onClick={act(onReply)}>
            <CornerUpLeft className="size-4 text-ink-400" />
            Reply
          </button>

          <button type="button" role="menuitem" className={item} onClick={act(onInfo)}>
            <Info className="size-4 text-ink-400" />
            Info
          </button>

          {canEdit && (
            <button type="button" role="menuitem" className={item} onClick={act(onEdit)}>
              <Pencil className="size-4 text-ink-400" />
              Edit
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              role="menuitem"
              className={cn(item, "text-brand-600 hover:bg-brand-50")}
              onClick={act(onDelete)}
            >
              <Trash2 className="size-4" />
              Delete
            </button>
          )}

          {/* An admin can read what an edit replaced; nobody else is offered it. */}
          {manager && message.revisions.length > 0 && (
            <button type="button" role="menuitem" className={item} onClick={act(onToggleHistory)}>
              <History className="size-4 text-ink-400" />
              {showingHistory ? "Hide earlier versions" : `${message.revisions.length} earlier`}
            </button>
          )}

          {/* Who said it, and who they answer to. Two lines with an icon
              each: the labels were longer than the answers. */}
          <div className="mt-1.5 rounded-lg bg-ink-50 px-2 py-1.5">
            <p className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-bold text-ink-900">
                {mine ? "You" : message.author.name}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold",
                  message.side === "raiser"
                    ? "bg-chat-accent-soft text-chat-accent-strong"
                    : "bg-ink-200 text-ink-600",
                )}
              >
                {message.side === "raiser" ? "Requester" : departmentName}
              </span>
            </p>

            <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-ink-600">
              <Building2 className="mt-px size-3 shrink-0 text-ink-400" />
              <span className="min-w-0">{units}</span>
            </p>
            <p className="mt-0.5 flex items-start gap-1.5 text-[11px] leading-snug text-ink-600">
              <Users className="mt-px size-3 shrink-0 text-ink-400" />
              <span className="min-w-0">{departments}</span>
            </p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * One line of the conversation, drawn the way a messaging app draws it: no
 * avatar column, the time tucked into the bottom of the bubble, and every
 * control behind the caret that appears on hover.
 */
export function ChatMessage({
  message,
  mine,
  pending,
  departmentName,
  manager,
  editing,
  editDraft,
  onEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  onJump,
  highlighted,
  showHeader,
  busy,
}: {
  message: MessageRecord;
  mine: boolean;
  /** Written here but not yet acknowledged by the server. */
  pending?: boolean;
  departmentName: string;
  /** Admins are shown what a withdrawn line said, and what an edit replaced. */
  manager: boolean;
  editing: boolean;
  editDraft: string;
  onEditDraft: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  /** Walks back to a quoted message. */
  onJump: (id: string) => void;
  /** Just jumped to, and briefly marked so the eye finds it. */
  highlighted: boolean;
  /**
   * Whether this line starts a new run from one person. A name repeated on
   * every bubble of a run is noise, and so is the tag beside it.
   */
  showHeader: boolean;
  busy: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Nothing to act on while it is still in flight.
  const settled = !pending;
  const canEdit = mine && settled && !message.deleted;
  const gone = message.deleted && !manager;
  const image = message.attachment?.kind === "image";

  // The person who raised the ticket is worth marking on every line they
  // write: in a thread between two departments, "who wants this" is the thing
  // a reader is trying to work out.
  const raiser = message.side === "raiser";

  // Never on your own lines: you know what you asked for.
  const header = showHeader && !mine && !gone && (
    <p className={cn("mb-1 flex flex-wrap items-center gap-1.5", image && "px-1 pt-0.5")}>
      <span className={cn("text-[11px] leading-none font-bold", nameColour(message.author.id))}>
        {message.author.name}
      </span>
      {raiser && (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-chat-accent/15 px-1 py-px text-[9px] leading-none font-semibold text-chat-accent-strong"
          title="Raised this request"
        >
          <TicketIcon className="size-2.5" />
          Requester
        </span>
      )}
    </p>
  );

  /**
   * One tick for sent, two once somebody it was written for has had the thread
   * open since, and two in blue once all of them have - the shorthand every
   * messaging app has trained people to read. Only ever on your own lines.
   */
  const ticks = (() => {
    if (!mine || message.deleted || pending) return null;

    const { by, of } = message.seen ?? { by: 0, of: 0 };
    const all = of > 0 && by >= of;
    const title =
      of === 0
        ? "Sent"
        : by === 0
          ? "Sent · nobody has opened it yet"
          : all
            ? `Seen by ${of === 1 ? "them" : "everyone"}`
            : `Seen by ${by} of ${of}`;

    return (
      <span title={title} className={cn("inline-flex", all && "text-chat-seen")}>
        {by === 0 ? (
          <Check className="size-3.5" strokeWidth={2.5} />
        ) : (
          <CheckCheck className="size-3.5" strokeWidth={2.5} />
        )}
      </span>
    );
  })();

  const meta = (
    <span
      className={cn(
        "ml-2 inline-flex items-center gap-1 text-[10px] leading-none whitespace-nowrap",
        mine ? "text-chat-mine-meta" : "text-ink-400",
      )}
    >
      {message.editedAt && !message.deleted && <span className="italic">edited</span>}
      {pending ? "Sending..." : formatTime(message.createdAt)}
      {ticks}
    </span>
  );

  return (
    <div
      id={`msg-${message.id}`}
      className={cn("group/msg flex scroll-mt-4", mine ? "justify-end" : "justify-start")}
    >
      <div className="relative min-w-0 max-w-[85%]">
        {editing ? (
          <div className="w-full min-w-[15rem] rounded-lg border border-chat-accent-line bg-surface p-1.5">
            <textarea
              value={editDraft}
              maxLength={MAX_BODY}
              autoFocus
              onChange={(event) => onEditDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSaveEdit();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  onCancelEdit();
                }
              }}
              className={cn(
                "max-h-32 min-h-14 w-full resize-none rounded border border-line-strong bg-surface px-2 py-1.5",
                "text-[13px] leading-snug text-ink-900 focus:border-chat-accent focus:outline-none",
              )}
            />
            <div className="mt-1 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={onCancelEdit}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-ink-500 hover:bg-ink-100"
              >
                <X className="size-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={busy}
                className="flex items-center gap-1 rounded bg-chat-accent px-2 py-1 text-[11px] font-bold text-white hover:bg-chat-accent-strong disabled:opacity-50"
              >
                <Check className="size-3" />
                Save
              </button>
            </div>
          </div>
        ) : gone ? (
          // The thread is told a line existed and is gone, not what it said.
          <div className="rounded-lg border border-dashed border-line-strong px-2.5 py-1.5 text-[12px] text-ink-400 italic">
            This message was deleted
          </div>
        ) : (
          <div
            className={cn(
              "rounded-lg px-2 py-1.5 text-[13px] leading-snug break-words shadow-sm",
              mine
                ? "rounded-tr-none bg-chat-mine-bg text-chat-mine-fg"
                : "rounded-tl-none bg-ink-100 text-ink-800",
              image && "p-1",
              pending && "opacity-70",
              // A withdrawn line an admin can still read is set apart, so it is
              // never mistaken for something the thread can see.
              message.deleted && "opacity-80 ring-1 ring-status-waiting-fg/50 ring-inset",
              highlighted && "ring-2 ring-chat-accent",
            )}
          >
            {/* Always above the photo, never under it. */}
            {header}

            {message.replyTo && (
              <Quote quote={message.replyTo} mine={mine} onJump={onJump} />
            )}

            {message.attachment && (
              <MessageAttachmentView attachment={message.attachment} mine={Boolean(mine)} />
            )}

            {/* The clock sits on the last line of the text when there is room
                for it, and drops to its own line when there is not. */}
            <div className={cn(image && "px-1.5 pt-1 pb-0.5")}>
              {message.body && <span className="whitespace-pre-wrap">{message.body}</span>}
              <span className="float-right mt-0.5 translate-y-0.5">{meta}</span>
              <span className="clear-both block" />
            </div>

            {manager && message.adminOnly && (
              <p className="mt-1 inline-flex items-center gap-1 rounded bg-status-waiting-bg px-1.5 py-0.5 text-[10px] font-bold text-status-waiting-fg">
                <EyeOff className="size-3" />
                Deleted · admins only
              </p>
            )}
          </div>
        )}

        {/* Earlier versions, for an admin who asked for them. */}
        {manager && showHistory && message.revisions.length > 0 && (
          <ul className="mt-1 space-y-1">
            {message.revisions.map((revision, index) => (
              <li
                key={`${revision.replacedAt}-${index}`}
                className="rounded border border-dashed border-line-strong px-2 py-1 text-[11px] text-ink-500"
              >
                <span className="mr-1.5 text-[9px] font-bold tracking-wide text-ink-400 uppercase">
                  before {formatTime(revision.replacedAt)}
                </span>
                {revision.body || "(empty)"}
              </li>
            ))}
          </ul>
        )}

        {settled && !editing && (
          <MessageMenu
            message={message}
            mine={mine}
            manager={manager}
            canEdit={canEdit}
            showingHistory={showHistory}
            onReply={onReply}
            onEdit={onStartEdit}
            onDelete={onDelete}
            onInfo={() => setInfoOpen(true)}
            onToggleHistory={() => setShowHistory((current) => !current)}
            departmentName={departmentName}
          />
        )}

        {infoOpen && <InfoDialog message={message} onClose={() => setInfoOpen(false)} />}
      </div>
    </div>
  );
}
