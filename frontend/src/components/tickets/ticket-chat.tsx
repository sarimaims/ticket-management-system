"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Mic, MessagesSquare, SendHorizontal, Square } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notification-provider";
import { dayLabel } from "@/components/notifications/notification-shared";
import { errorMessage } from "@/lib/api";
import { initials } from "@/lib/auth";
import { revalidateMessages, sendMessage, type MessageRecord } from "@/lib/messages";
import { ATTACHMENT_LIMITS, formatBytes, formatDuration, uploadAttachment } from "@/lib/uploads";
import {
  DraftPreview,
  MessageAttachmentView,
  useVoiceRecorder,
  type Draft,
} from "@/components/tickets/chat-attachments";
import type { TicketRecord } from "@/lib/tickets";
import { cn, formatTime } from "@/lib/utils";

/** How often an open thread asks whether anything has been said. */
const REFRESH_MS = 5000;

/** The ceiling the API enforces, so the box stops before the server refuses. */
const MAX_BODY = 2000;

/** With fewer than this many characters left, the counter appears. */
const COUNTER_FROM = 200;

/** One blip is not worth a red line; two in a row is. */
const FAILURES_BEFORE_ERROR = 2;

/** A placeholder id cannot collide with a real one. */
const PENDING = "pending-";

/**
 * Folds a fresh thread into the one on screen.
 *
 * A message is written once and never edited or deleted, so the two lists are
 * unioned rather than swapped: a poll that was already in the air when we sent
 * cannot drop the line we just added.
 */
function merge(previous: MessageRecord[], incoming: MessageRecord[]) {
  const unchanged =
    previous.length === incoming.length &&
    previous.every((message, index) => message.id === incoming[index]?.id);
  if (unchanged) return previous;

  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Today / Yesterday / a date, above each run of messages from one day. */
function groupByDay(messages: MessageRecord[]) {
  const groups: { label: string; items: MessageRecord[] }[] = [];

  for (const message of messages) {
    const label = dayLabel(message.createdAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(message);
    else groups.push({ label, items: [message] });
  }

  return groups;
}

/** Which end of the ticket someone wrote from, named rather than colour-coded. */
function SideTag({
  side,
  departmentName,
}: {
  side: MessageRecord["side"];
  departmentName: string;
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
        side === "raiser" ? "bg-brand-50 text-brand-700" : "bg-ink-100 text-ink-600",
      )}
    >
      {side === "raiser" ? "Requester" : departmentName}
    </span>
  );
}

function Bubble({
  message,
  mine,
  pending,
  departmentName,
}: {
  message: MessageRecord;
  mine: boolean;
  /** Written here but not yet acknowledged by the server. */
  pending?: boolean;
  departmentName: string;
}) {
  return (
    <div className={cn("flex items-start gap-2", mine && "flex-row-reverse")}>
      {/* Brand for the side that asked, slate for the side answering - so a
          long thread still reads as two voices at a glance. */}
      <Avatar
        initials={initials(message.author.name)}
        tone={message.side === "raiser" ? "head" : "team"}
        className="size-7 text-[10px]"
      />

      <div className={cn("flex min-w-0 max-w-[85%] flex-col", mine && "items-end")}>
        <p
          className={cn(
            "mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400",
            mine && "flex-row-reverse",
          )}
        >
          <span className="font-semibold text-ink-700">{mine ? "You" : message.author.name}</span>
          {!mine && <SideTag side={message.side} departmentName={departmentName} />}
          <span>{pending ? "Sending..." : formatTime(message.createdAt)}</span>
        </p>

        <div
          className={cn(
            "rounded-2xl text-[13px] leading-relaxed break-words whitespace-pre-wrap",
            // A photo fills its bubble; anything else keeps the padding.
            message.attachment?.kind === "image" ? "overflow-hidden p-1" : "px-3.5 py-2",
            mine ? "rounded-tr-sm bg-brand-600 text-white" : "rounded-tl-sm bg-ink-100 text-ink-800",
            pending && "opacity-60",
          )}
        >
          {message.attachment && (
            <MessageAttachmentView attachment={message.attachment} mine={Boolean(mine)} />
          )}
          {message.body && (
            <span className={cn("block", message.attachment && "px-2.5 pt-2 pb-1")}>
              {message.body}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The conversation on one ticket: the person who raised it and the department
 * working it, in one thread.
 *
 * It is deliberately only talk. Status, dates and assignment stay where they
 * are - settling a question should not need either side to edit the other's
 * fields, which is the whole reason this exists.
 *
 * Kept current by the same conditional poll the queue uses: every request
 * carries the tag of the last answer, so a quiet thread costs a 304 with no
 * body and repaints nothing.
 */
export function TicketChat({
  ticket,
  onCount,
}: {
  ticket: TicketRecord;
  /** How many messages the server has. Must be a stable function. */
  onCount?: (count: number) => void;
}) {
  const { session, features } = useAuth();
  const { items, markOneRead } = useNotifications();

  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [pending, setPending] = useState<MessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const etag = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const failures = useRef(0);
  /** Whether a thread has ever arrived - until it has, any failure is worth showing. */
  const seeded = useRef(false);
  const nextPendingId = useRef(0);

  const ticketId = ticket.id;
  const departmentName = ticket.department.name ?? "Department";
  const meId = session?.id;

  const fetchNow = useCallback(async () => {
    // One request at a time: a slow answer must not let the next tick stack on
    // top of it.
    if (inFlight.current) return;

    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const result = await revalidateMessages(ticketId, etag.current, controller.signal);
      if (!alive.current) return;

      etag.current = result.etag;
      failures.current = 0;
      seeded.current = true;

      // A 304 means nobody has written, so nothing here is called and the
      // thread does not re-render.
      if (result.changed) setMessages((current) => merge(current, result.data.messages));
      setError((current) => (current ? "" : current));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (!alive.current) return;

      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_ERROR || !seeded.current) {
        setError(errorMessage(caught));
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (alive.current) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    alive.current = true;
    etag.current = null;
    seeded.current = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const step = async (force = false) => {
      if (stopped) return;

      const idle = document.visibilityState === "hidden" || navigator.onLine === false;
      if (force || !idle) await fetchNow();
      if (stopped) return;

      timer = setTimeout(() => void step(), REFRESH_MS);
    };

    // The first load always runs, even if the tab opened in the background.
    void step(true);

    const wake = () => {
      if (document.visibilityState === "visible") void step(true);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      stopped = true;
      alive.current = false;
      if (timer) clearTimeout(timer);
      inFlight.current?.abort();
      inFlight.current = null;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [fetchNow]);

  /**
   * Reading the thread is what marks its bell entries read. The feed is the
   * only per-person record of what has been seen, so opening the chat clears
   * exactly the notifications this ticket produced, and nothing else.
   */
  useEffect(() => {
    const unread = items.filter(
      (item) => item.type === "ticket.message" && !item.read && item.ticket === ticketId,
    );
    for (const item of unread) void markOneRead(item.id);
  }, [items, ticketId, markOneRead]);

  useEffect(() => {
    onCount?.(messages.length);
  }, [messages.length, onCount]);

  // What is attached to the line being written, and how far it has uploaded.
  const [draftFile, setDraftFile] = useState<Draft | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();

  const attachmentsAllowed = features.attachments;

  const dropDraftFile = useCallback(() => {
    setDraftFile((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setPercent(null);
  }, []);

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_LIMITS.image.maxBytes) {
      setError(`That photo is ${formatBytes(file.size)}; the limit is 10 MB.`);
      return;
    }
    setError("");
    dropDraftFile();
    setDraftFile({
      kind: "image",
      file,
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
    });
  };

  const finishRecording = async () => {
    const recorded = await recorder.stop();
    if (!recorded) {
      setError("That was too short to send.");
      return;
    }
    setError("");
    dropDraftFile();
    setDraftFile(recorded);
  };

  const thread = useMemo(() => [...messages, ...pending], [messages, pending]);
  const groups = useMemo(() => groupByDay(thread), [thread]);

  // Following the conversation means staying at the bottom; reading back
  // through it means being left where you are.
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || !following.current) return;
    box.scrollTop = box.scrollHeight;
  }, [thread.length, loading]);

  const send = async () => {
    const body = draft.trim();
    const file = draftFile;
    if ((!body && !file) || sending) return;

    // On screen immediately, greyed until the server has it.
    nextPendingId.current += 1;
    const placeholder: MessageRecord = {
      id: `${PENDING}${nextPendingId.current}`,
      ticket: ticketId,
      author: { id: meId ?? "", name: session?.name ?? "You" },
      authorRole: session?.role ?? "user",
      side: ticket.raisedBy.id === meId ? "raiser" : "department",
      body,
      // The local copy is shown while it uploads, so the thread does not jump
      // when the real one arrives.
      attachment: file
        ? {
            kind: file.kind,
            mimeType: file.file.type,
            size: file.file.size,
            durationMs: file.durationMs ?? null,
            filename: file.filename,
            url: file.previewUrl,
          }
        : null,
      createdAt: new Date().toISOString(),
    };

    setPending((current) => [...current, placeholder]);
    setDraft("");
    setSending(true);
    following.current = true;

    try {
      // The file goes straight to storage; only its key passes through the API.
      let stored: { kind: Draft["kind"]; key: string; durationMs?: number; filename?: string } | undefined;
      if (file) {
        setPercent(0);
        const key = await uploadAttachment(ticketId, file.file, {
          kind: file.kind,
          filename: file.filename,
          onProgress: setPercent,
        });
        stored = {
          kind: file.kind,
          key,
          durationMs: file.durationMs,
          filename: file.filename,
        };
      }

      const saved = await sendMessage(ticketId, body, stored);
      if (!alive.current) return;
      setMessages((current) => merge(current, [saved]));
      setPending((current) => current.filter((item) => item.id !== placeholder.id));
      dropDraftFile();
    } catch (caught) {
      if (!alive.current) return;
      // Nothing was said, so nothing is left on screen pretending it was: the
      // text goes back in the box to be sent again.
      setPending((current) => current.filter((item) => item.id !== placeholder.id));
      setDraft((current) => current || body);
      setError(errorMessage(caught));
    } finally {
      if (alive.current) {
        setSending(false);
        setPercent(null);
      }
    }
  };

  const remaining = MAX_BODY - draft.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {loading && thread.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-400">Loading the conversation...</p>
        )}

        {!loading && thread.length === 0 && (
          <div className="py-10 text-center">
            <MessagesSquare className="mx-auto size-6 text-ink-300" />
            <p className="mt-2 text-sm font-semibold text-ink-700">No messages yet</p>
            <p className="mt-0.5 text-sm text-ink-400">
              Ask a question or give an update here. {ticket.raisedBy.name} and {departmentName} both
              see this thread.
            </p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="space-y-3">
            <p className="text-center">
              <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold text-ink-500">
                {group.label}
              </span>
            </p>
            {group.items.map((message) => (
              <Bubble
                key={message.id}
                message={message}
                mine={message.author.id === meId}
                pending={message.id.startsWith(PENDING)}
                departmentName={departmentName}
              />
            ))}
          </div>
        ))}
      </div>

      {(error || recorder.error) && (
        <p
          role="alert"
          className="flex items-start gap-2 border-t border-line bg-brand-50 px-5 py-2.5 text-xs font-medium text-brand-700"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          {error || recorder.error}
        </p>
      )}

      <form
        className="border-t border-line px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {draftFile && (
          <DraftPreview draft={draftFile} percent={percent} onRemove={dropDraftFile} />
        )}

        {recorder.recording && (
          <div className="mb-2 flex items-center gap-3 rounded-field border border-brand-200 bg-brand-50 px-3 py-2">
            <span className="size-2.5 animate-pulse rounded-full bg-brand-600" />
            <span className="flex-1 text-[13px] font-semibold text-brand-700">
              Recording {formatDuration(recorder.elapsed)}
            </span>
            <button
              type="button"
              onClick={() => recorder.cancel()}
              className="text-[12px] font-semibold text-ink-500 hover:text-ink-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void finishRecording()}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-brand-700"
            >
              <Square className="size-3 fill-current" />
              Stop
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Photo and voice note, side by side with the box they belong to. */}
          <input
            ref={filePicker}
            type="file"
            accept={ATTACHMENT_LIMITS.image.accept}
            className="hidden"
            onChange={(event) => {
              chooseImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => filePicker.current?.click()}
            disabled={!attachmentsAllowed || sending || recorder.recording}
            title={attachmentsAllowed ? "Attach a photo" : "File storage is not configured yet"}
            aria-label="Attach a photo"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-lg border border-line-strong text-ink-500 transition-colors",
              "hover:bg-ink-50 hover:text-ink-700 disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <ImagePlus className="size-4.5" />
          </button>

          <button
            type="button"
            onClick={() => (recorder.recording ? void finishRecording() : void recorder.start())}
            disabled={!attachmentsAllowed || !recorder.supported || sending}
            title={
              !attachmentsAllowed
                ? "File storage is not configured yet"
                : recorder.supported
                  ? "Record a voice note"
                  : "This browser cannot record audio"
            }
            aria-label={recorder.recording ? "Stop recording" : "Record a voice note"}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-lg border transition-colors",
              recorder.recording
                ? "border-brand-300 bg-brand-50 text-brand-600"
                : "border-line-strong text-ink-500 hover:bg-ink-50 hover:text-ink-700",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <Mic className="size-4.5" />
          </button>

          <textarea
            value={draft}
            maxLength={MAX_BODY}
            rows={1}
            placeholder={`Message ${departmentName}...`}
            aria-label={`Message on ticket ${ticket.number}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line: what everyone
              // already expects of a message box.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            className={cn(
              "max-h-32 min-h-11 w-full flex-1 resize-none rounded-field border border-line-strong bg-surface px-3.5 py-2.5",
              "text-[13px] leading-relaxed text-ink-900 transition-colors placeholder:text-ink-400",
              "focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none",
            )}
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !draftFile) || sending || recorder.recording}
            aria-label="Send message"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-white transition-colors",
              "hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <SendHorizontal className="size-4.5" />
          </button>
        </div>

        <p className="mt-1.5 flex items-center justify-between text-[11px] text-ink-400">
          <span>Enter to send · Shift + Enter for a new line</span>
          {remaining <= COUNTER_FROM && <span>{remaining} left</span>}
        </p>
      </form>
    </div>
  );
}
