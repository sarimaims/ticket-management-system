"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  ChevronDown,
  CornerUpLeft,
  Mail,
  Mic,
  MessagesSquare,
  Paperclip,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notification-provider";
import { dayLabel } from "@/components/notifications/notification-shared";
import { errorMessage } from "@/lib/api";
import { initials, isAdmin } from "@/lib/auth";
import { listDepartmentMembers, type MemberOption } from "@/lib/departments";
import {
  deleteMessage,
  editMessage,
  revalidateMessages,
  sendMessage,
  MAX_BODY,
  type MessageRecord,
} from "@/lib/messages";
import { ChatMessage } from "@/components/tickets/chat-message";
import { ATTACHMENT_LIMITS, formatBytes, formatDuration, uploadAttachment } from "@/lib/uploads";
import {
  DraftPreview,
  PhotoLightbox,
  useVoiceRecorder,
  type Draft,
} from "@/components/tickets/chat-attachments";
import { attachmentHref, type TicketRecord } from "@/lib/tickets";
import { cn, formatTime } from "@/lib/utils";

/** How often an open thread asks whether anything has been said. */
const REFRESH_MS = 5000;

/** With fewer than this many characters left, the counter appears. */
const COUNTER_FROM = 200;

/** One blip is not worth a red line; two in a row is. */
const FAILURES_BEFORE_ERROR = 2;

/** A placeholder id cannot collide with a real one. */
const PENDING = "pending-";

/** Enough of a line to tell whether it has changed since we last saw it. */
const signature = (message: MessageRecord) =>
  `${message.id}:${message.editedAt ?? ""}:${message.deleted ? "x" : ""}:${message.body.length}`;

/**
 * Folds a fresh thread into the one on screen.
 *
 * The two lists are unioned rather than swapped, so a poll that was already in
 * the air when we sent cannot drop the line we just added. Sameness is judged
 * on content as well as identity: a line that was edited or withdrawn keeps
 * its id, and comparing ids alone would leave the old text on screen.
 */
function merge(previous: MessageRecord[], incoming: MessageRecord[]) {
  const unchanged =
    previous.length === incoming.length &&
    previous.every((message, index) => {
      const other = incoming[index];
      return other !== undefined && signature(message) === signature(other);
    });
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
/**
 * Why somebody is in this conversation.
 *
 * Ordered by how much the thread is theirs: the person who asked, then whoever
 * is actually holding it, then the rest of the department who can read it and
 * join in.
 */
type Standing = "requester" | "holding" | "head" | "team";

const STANDING: Record<Standing, { label: string; detail: string; chip: string }> = {
  requester: {
    label: "Raised by",
    detail: "Raised this ticket",
    chip: "bg-brand-50 text-brand-700",
  },
  holding: {
    label: "Handled by",
    detail: "Handling this ticket",
    chip: "bg-status-completed-bg text-status-completed-fg",
  },
  head: { label: "Head", detail: "Head of the department", chip: "bg-role-head-bg text-role-head-fg" },
  team: { label: "Member", detail: "Member of the department", chip: "bg-ink-100 text-ink-600" },
};

type Participant = {
  id: string;
  name: string;
  standing: Standing;
  /** Where they sit, as "Unit · Department". Empty for a manager, who sits above both. */
  where: string;
  /** Only known for the raiser; the member list is names and roles only. */
  email?: string;
};

/** How many faces the collapsed header stacks. */
const FACES = 2;

/**
 * The group, the way a messaging app shows one: the faces and names that
 * matter - who raised it and who has it - then "+N" for the rest, opening
 * into the list with each person's part in it.
 *
 * It is not a guest list anybody chose - it is everybody the ticket is already
 * visible to, which is the raiser plus the department being asked. Two people
 * in the same thread should not have to guess who else is reading it.
 */
function People({
  people,
  meId,
  open,
  onToggle,
  onPick,
}: {
  people: Participant[];
  meId?: string;
  open: boolean;
  onToggle: () => void;
  onPick: (person: Participant) => void;
}) {
  if (people.length === 0) return null;

  // The raiser and whoever holds it lead; the rest of the room is the "+N".
  const key = people.filter(
    (person) => person.standing === "requester" || person.standing === "holding",
  );
  const shown = key.length > 0 ? key : people.slice(0, FACES);
  const more = people.length - shown.length;

  return (
    <div className="shrink-0 border-b border-line px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${people.length} people in this conversation`}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="flex shrink-0 -space-x-2">
          {shown.slice(0, FACES).map((person) => (
            <Avatar
              key={person.id}
              initials={initials(person.name)}
              tone={person.standing === "requester" ? "head" : "team"}
              className="size-7 text-[10px] ring-2 ring-surface"
            />
          ))}
        </span>

        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-800">
          {shown.map((person) => person.name).join(", ")}
        </span>

        {more > 0 && (
          <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
            +{more}
          </span>
        )}

        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => onPick(person)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-ink-50"
              >
                <Avatar
                  initials={initials(person.name)}
                  tone={person.standing === "requester" ? "head" : "team"}
                  className="size-6 text-[9px]"
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-[13px] font-medium text-ink-800">{person.name}</span>
                  {person.id === meId && <span className="ml-1 text-[13px] text-ink-400">(you)</span>}
                  {/* Where they sit. A thread can span units now, so "who is
                      this" is half the question and "from where" is the other. */}
                  {person.where && (
                    <span className="ml-1.5 text-[11px] text-ink-400">{person.where}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
                    STANDING[person.standing].chip,
                  )}
                >
                  {STANDING[person.standing].label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One person in the thread, opened from the list. */
function PersonCard({
  person,
  meId,
  onClose,
}: {
  person: Participant | null;
  meId?: string;
  onClose: () => void;
}) {
  return (
    <Modal open={person !== null} onClose={onClose} title="Contact details" className="max-w-sm">
      {person && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar
              initials={initials(person.name)}
              tone={person.standing === "requester" ? "head" : "team"}
              className="size-11 text-sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">
                {person.name}
                {person.id === meId && <span className="ml-1 font-normal text-ink-400">(you)</span>}
              </p>
              <p className="text-[12px] text-ink-500">{STANDING[person.standing].detail}</p>
            </div>
          </div>

          {(person.where || person.email) && (
            <ul className="space-y-1.5 text-[13px] text-ink-600">
              {person.where && (
                <li className="flex items-center gap-2">
                  <Building2 className="size-4 shrink-0 text-ink-400" />
                  <span className="truncate">{person.where}</span>
                </li>
              )}
              {person.email && (
                <li className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0 text-ink-400" />
                  <span className="truncate">{person.email}</span>
                </li>
              )}
            </ul>
          )}

          {person.email && person.id !== meId && (
            <a
              href={`mailto:${person.email}`}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-ink-50"
            >
              <Mail className="size-4" />
              Email
            </a>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Something that happened, sitting in the thread among the things that were
 * said: raised, retitled, handed on.
 *
 * Centred and quiet, the way a messaging app marks its own announcements, so
 * it reads as part of the story without pretending somebody said it.
 */
/**
 * The shape of a conversation, while the real one is on its way.
 *
 * Bubbles rather than a spinner: the pane keeps the height and rhythm it is
 * about to have, so nothing jumps when the messages land. The rows fade in
 * turn, which reads as "arriving" rather than "stuck".
 */
function ChatSkeleton() {
  const rows = [
    { mine: false, width: "w-44", height: "h-11" },
    { mine: true, width: "w-32", height: "h-8" },
    { mine: false, width: "w-52", height: "h-14" },
    { mine: true, width: "w-40", height: "h-8" },
    { mine: false, width: "w-36", height: "h-8" },
  ];

  return (
    <div aria-hidden="true" className="space-y-3">
      <p className="text-center">
        <span className="inline-block h-5 w-14 animate-pulse rounded-full bg-ink-100" />
      </p>

      {rows.map((row, index) => (
        <div key={index} className={cn("flex", row.mine ? "justify-end" : "justify-start")}>
          <span
            // Staggered, so the column ripples instead of blinking as one.
            style={{ animationDelay: `${index * 120}ms` }}
            className={cn(
              "block animate-pulse rounded-lg",
              row.width,
              row.height,
              row.mine ? "rounded-tr-none bg-chat-mine-bg" : "rounded-tl-none bg-ink-100",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function SystemLine({ message }: { message: MessageRecord }) {
  return (
    <p className="px-6 text-center text-[11px] leading-relaxed">
      {/* Amber rather than grey: what happened to the request is not another
          grey message, and a thread of both should say which is which at a
          glance. */}
      <span className="rounded-full bg-chat-system-bg px-2.5 py-1 text-chat-system-fg">
        <span className="font-semibold">{message.author.name}</span> {message.body}
        <span className="ml-1.5 opacity-70">{formatTime(message.createdAt)}</span>
      </span>
    </p>
  );
}

/**
 * The request itself, pinned to the top of the thread.
 *
 * Every conversation here is about this one ask, so it opens with it - the
 * way a thread in a chat app starts with the post it replies to - rather than
 * making the reader flip to Details to remember what was wanted.
 */
function RequestCard({ ticket }: { ticket: TicketRecord }) {
  /** Photos that would not load; they fall back to a file chip. */
  const [broken, setBroken] = useState<number[]>([]);
  /** The photo being looked at, if one is. */
  const [viewing, setViewing] = useState<TicketRecord["attachments"][number] | null>(null);
  const isImage = (file: TicketRecord["attachments"][number]) =>
    file.mimeType.startsWith("image/") && !broken.includes(file.index);
  const images = ticket.attachments.filter(isImage);
  const others = ticket.attachments.filter((file) => !isImage(file));

  return (
    <div className="rounded-xl border border-line bg-ink-100/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-wide text-ink-400 uppercase">
        Request · #{ticket.number}
      </p>
      <p className="mt-1 text-[13px] leading-snug font-bold text-ink-900">{ticket.subject}</p>
      {ticket.description && (
        <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-600">
          {ticket.description}
        </p>
      )}

      {images.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {/* Three to a row: what belongs at the top of a thread is the fact
              that a photo came with the request, not the photo. A click opens
              it over the page at the size it was meant to be read at. */}
          {images.map((file) => (
            <button
              key={file.index}
              type="button"
              onClick={() => setViewing(file)}
              className="block cursor-zoom-in overflow-hidden rounded-lg border border-line bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the API
                  redirects to a short-lived signed URL the optimiser cannot reach. */}
              <img
                src={attachmentHref(ticket.id, file.index)}
                alt={file.filename}
                loading="lazy"
                onError={() => setBroken((current) => [...current, file.index])}
                className="aspect-square w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {others.map((file) => (
            <li key={file.index}>
              <a
                href={attachmentHref(ticket.id, file.index)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-ink-50 px-2 py-1 text-[11px] font-medium text-ink-700 transition-colors hover:bg-ink-100"
              >
                <Paperclip className="size-3 shrink-0 text-ink-400" />
                <span className="truncate">{file.filename}</span>
                <span className="shrink-0 text-ink-400">{formatBytes(file.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <PhotoLightbox
          src={attachmentHref(ticket.id, viewing.index)}
          alt={viewing.filename}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

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
  /** Everyone in the department being asked; the raiser comes off the ticket. */
  const [team, setTeam] = useState<MemberOption[] | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [picked, setPicked] = useState<Participant | null>(null);
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
      // An aborted request is not an answer. React mounts an effect twice in
      // development, so the first fetch is always cancelled - and clearing the
      // flag here declared "no messages yet" while the real request was still
      // in the air, which is the flash this guard removes.
      if (alive.current && !controller.signal.aborted) setLoading(false);
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

  useEffect(() => {
    const controller = new AbortController();

    listDepartmentMembers(ticket.department.id, controller.signal)
      .then(setTeam)
      .catch(() => setTeam([]));

    return () => controller.abort();
  }, [ticket.department.id]);

  /**
   * Everyone this thread is visible to, most involved first.
   *
   * The strongest reason wins: somebody who raised the ticket and also works
   * in the department is listed once, as the requester.
   */
  const people = useMemo<Participant[]>(() => {
    const holders = new Set(ticket.assignees.map((person) => person.id));
    const seen = new Set<string>();
    const out: Participant[] = [];

    const place = (unit?: string, department?: string) =>
      [unit, department].filter(Boolean).join(" · ");

    // Everyone on the receiving side sits in the one department being asked;
    // the raiser sits wherever they raised it from.
    const receiving = place(ticket.department.unit?.name, ticket.department.name);
    const asking = ticket.fromDepartments
      .map((item) => place(item.unit?.name, item.name))
      .filter(Boolean)
      .join(", ");

    const add = (id: string, name: string, standing: Standing, where: string, email?: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name, standing, where, email });
    };

    add(
      ticket.raisedBy.id,
      ticket.raisedBy.name ?? "Requester",
      "requester",
      asking,
      ticket.raisedBy.email,
    );

    for (const member of team ?? []) {
      if (holders.has(member.id)) add(member.id, member.name, "holding", receiving);
    }
    // A manager can hold a ticket without being in the department, so anyone
    // still unaccounted for is taken from the ticket itself - and sits above
    // the org chart rather than in it.
    for (const person of ticket.assignees) {
      add(person.id, person.name ?? "Someone", "holding", "");
    }
    for (const member of team ?? []) {
      add(member.id, member.name, member.departmentRole, receiving);
    }

    return out;
  }, [ticket.raisedBy, ticket.assignees, ticket.department, ticket.fromDepartments, team]);

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

  /**
   * The line being answered, and the one just jumped to from a quote. Both are
   * only ever about what is on screen, so neither is persisted.
   */
  const [replyTo, setReplyTo] = useState<MessageRecord | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  // The line being corrected, if any, and the one waiting to be withdrawn.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MessageRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const manager = isAdmin(session);

  const saveEdit = async (message: MessageRecord) => {
    const body = editDraft.trim();
    if (!body && !message.attachment) {
      setError("A message cannot be empty. Delete it instead.");
      return;
    }
    if (body === message.body) {
      setEditingId(null);
      return;
    }

    setBusy(true);
    try {
      const saved = await editMessage(ticketId, message.id, body);
      setMessages((current) => merge(current, [saved]));
      setEditingId(null);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const withdraw = async (message: MessageRecord) => {
    setBusy(true);
    try {
      const saved = await deleteMessage(ticketId, message.id);
      setMessages((current) => merge(current, [saved]));
      setPendingDelete(null);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

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
    const answering = replyTo;
    if ((!body && !file) || sending) return;

    // On screen immediately, greyed until the server has it.
    nextPendingId.current += 1;
    const placeholder: MessageRecord = {
      id: `${PENDING}${nextPendingId.current}`,
      ticket: ticketId,
      kind: "text",
      event: null,
      author: { id: meId ?? "", name: session?.name ?? "You" },
      authorDepartments: [],
      authorUnits: [],
      // Quoted from what is already on screen, so the reply reads correctly
      // while it is still in flight.
      replyTo: answering
        ? {
            id: answering.id,
            author: answering.author,
            deleted: answering.deleted,
            body: answering.body.slice(0, 160),
            attachmentKind: answering.attachment?.kind ?? null,
          }
        : null,
      authorRole: session?.role ?? "user",
      // Nobody can have seen it yet; the server's answer replaces this.
      seen: { by: 0, of: 0 },
      side: ticket.raisedBy.id === meId ? "raiser" : "department",
      body,
      editedAt: null,
      deleted: false,
      deletedAt: null,
      deletedBy: null,
      revisions: [],
      adminOnly: false,
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
    setReplyTo(null);
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

      const saved = await sendMessage(ticketId, body, stored, answering?.id ?? null);
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
      setReplyTo((current) => current ?? answering);
      setError(errorMessage(caught));
    } finally {
      if (alive.current) {
        setSending(false);
        setPercent(null);
      }
    }
  };

  const startReply = (message: MessageRecord) => {
    setReplyTo(message);
    composer.current?.focus();
  };

  /**
   * Walks back to a quoted line and marks it, briefly. Following the
   * conversation is switched off on the way: being sent back up the thread and
   * then yanked to the bottom by the next message is worse than not jumping.
   */
  const jumpTo = (id: string) => {
    const node = document.getElementById(`msg-${id}`);
    if (!node) return;

    node.scrollIntoView({ block: "center", behavior: "smooth" });
    following.current = false;
    setHighlight(id);
    window.setTimeout(() => setHighlight((current) => (current === id ? null : current)), 1800);
  };

  const remaining = MAX_BODY - draft.length;

  // With something written or attached, the round button sends; until then it
  // records, the way a messaging app does it.
  const canSend = Boolean(draft.trim() || draftFile) && !recorder.recording;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <People
        people={people}
        meId={meId}
        open={peopleOpen}
        onToggle={() => setPeopleOpen((current) => !current)}
        onPick={setPicked}
      />
      <PersonCard person={picked} meId={meId} onClose={() => setPicked(null)} />

      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        <RequestCard ticket={ticket} />

        {loading && thread.length === 0 && <ChatSkeleton />}

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
            {group.items.map((message, index) =>
              message.kind === "system" ? (
                <SystemLine key={message.id} message={message} />
              ) : (
              <ChatMessage
                key={message.id}
                // One name per run of messages, the way a chat app does it. A
                // system line between two breaks the run, which is right: the
                // thread moved on to something else in between.
                showHeader={
                  group.items[index - 1]?.kind === "system" ||
                  group.items[index - 1]?.author.id !== message.author.id
                }
                message={message}
                mine={message.author.id === meId}
                pending={message.id.startsWith(PENDING)}
                departmentName={departmentName}
                manager={manager}
                editing={editingId === message.id}
                editDraft={editDraft}
                busy={busy}
                highlighted={highlight === message.id}
                onEditDraft={setEditDraft}
                onStartEdit={() => {
                  setEditingId(message.id);
                  setEditDraft(message.body);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => void saveEdit(message)}
                onDelete={() => setPendingDelete(message)}
                onReply={() => startReply(message)}
                onJump={jumpTo}
              />
              ),
            )}
          </div>
        ))}
      </div>

      {(error || recorder.error) && (
        <p
          role="alert"
          className="flex items-start gap-2 border-t border-line bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-700"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          {error || recorder.error}
        </p>
      )}

      <form
        className="border-t border-line px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {/* What is being answered, above the box, the way a chat app shows it. */}
        {replyTo && (
          <div className="mb-1.5 flex items-start gap-1.5 rounded-md border-l-[3px] border-chat-accent bg-ink-50 py-1 pr-1 pl-2">
            <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold text-chat-accent-strong">
                Replying to {replyTo.author.id === meId ? "yourself" : replyTo.author.name}
              </span>
              <span className="block truncate text-[11px] text-ink-500 italic">
                {replyTo.body ||
                  (replyTo.attachment?.kind === "image"
                    ? "Photo"
                    : replyTo.attachment
                      ? "Voice note"
                      : "Message")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid size-5 shrink-0 place-items-center rounded text-ink-400 hover:bg-ink-200 hover:text-ink-700"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {draftFile && (
          <DraftPreview draft={draftFile} percent={percent} onRemove={dropDraftFile} />
        )}

        {recorder.recording && (
          <div className="mb-2 flex items-center gap-3 rounded-field border border-chat-accent-line bg-chat-accent-soft px-3 py-2">
            <span className="size-2.5 animate-pulse rounded-full bg-chat-accent" />
            <span className="flex-1 text-[13px] font-semibold text-chat-accent-strong">
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
              className="flex items-center gap-1.5 rounded-lg bg-chat-accent px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-chat-accent-strong"
            >
              <Square className="size-3 fill-current" />
              Stop
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
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

          {/* One pill holding the box and what can be added to it. */}
          <div
            className={cn(
              "flex min-w-0 flex-1 items-end gap-1 rounded-2xl border border-line-strong bg-surface px-1.5 py-1",
              "transition-colors focus-within:border-chat-accent focus-within:ring-2 focus-within:ring-chat-accent/15",
            )}
          >
            <textarea
              ref={composer}
              value={draft}
              maxLength={MAX_BODY}
              rows={1}
              placeholder="Type a message"
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
                "max-h-28 min-h-7 w-full flex-1 resize-none border-0 bg-transparent px-1.5 py-1",
                "text-[13px] leading-snug text-ink-900 placeholder:truncate placeholder:text-ink-400",
                "focus:ring-0 focus:outline-none",
              )}
            />

            {/* Only near the ceiling, where it starts to matter. */}
            {remaining <= COUNTER_FROM && (
              <span className="mb-1.5 shrink-0 text-[10px] font-medium text-ink-400">
                {remaining}
              </span>
            )}

            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              disabled={!attachmentsAllowed || sending || recorder.recording}
              title={attachmentsAllowed ? "Attach a photo" : "File storage is not configured yet"}
              aria-label="Attach a photo"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-ink-500 transition-colors",
                "hover:bg-ink-100 hover:text-ink-700 disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              <Paperclip className="size-4" />
            </button>
          </div>

          {/* The round one: a microphone until there is something to send, and
              the send key the moment there is - so the common action is always
              under the same thumb. */}
          <button
            type={canSend ? "submit" : "button"}
            onClick={
              canSend
                ? undefined
                : () => (recorder.recording ? void finishRecording() : void recorder.start())
            }
            disabled={
              canSend
                ? sending
                : !attachmentsAllowed || !recorder.supported || sending
            }
            title={
              canSend
                ? "Send"
                : !attachmentsAllowed
                  ? "File storage is not configured yet"
                  : recorder.supported
                    ? "Record a voice note"
                    : "This browser cannot record audio"
            }
            aria-label={
              canSend ? "Send message" : recorder.recording ? "Stop recording" : "Record a voice note"
            }
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full text-white shadow-sm transition-colors",
              recorder.recording
                ? "bg-chat-accent-strong hover:bg-chat-accent"
                : "bg-chat-accent hover:bg-chat-accent-strong",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {canSend ? (
              <SendHorizontal className="size-4" />
            ) : recorder.recording ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
        </div>
      </form>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this message?"
        description="The thread will show that a message was deleted."
        className="max-w-md"
      >
        <p className="rounded-field bg-ink-50 px-3.5 py-2.5 text-sm text-ink-600 italic">
          {pendingDelete?.body || (pendingDelete?.attachment ? "(attachment)" : "")}
        </p>
        <p className="mt-3 text-sm text-ink-500">
          {departmentName} and {ticket.raisedBy.name} will see that a message was deleted, but not
          what it said. An admin can still read it.
        </p>

        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" size="sm" onClick={() => setPendingDelete(null)}>
            Keep it
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => pendingDelete && void withdraw(pendingDelete)}
          >
            {busy ? "Deleting…" : "Delete message"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
