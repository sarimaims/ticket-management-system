import { api, apiRevalidate } from "./api";
import type { Role } from "./auth";
import type { AttachmentKind } from "./uploads";

/** The ceiling the API enforces on one message. */
export const MAX_BODY = 2000;

/**
 * A photo, video, document or voice note hanging off a message. `url` is
 * signed by the API on every read and expires within the hour, so it is never
 * stored or shared.
 */
export type MessageAttachment = {
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  /** Voice notes only, in milliseconds. */
  durationMs: number | null;
  filename: string;
  url: string;
};

/**
 * Enough of the line being answered to show above a reply. It is resolved on
 * every read rather than copied at send time, so a quote follows the original
 * when its author corrects or withdraws it.
 */
export type MessageQuote = {
  id: string;
  author: { id: string; name: string };
  deleted: boolean;
  /** Empty for a withdrawn original, unless you are an admin. */
  body: string;
  attachmentKind: AttachmentKind | null;
};

/**
 * One line of a ticket's conversation. Name and standing are the author's at
 * the time of writing, so an old message still reads correctly after a rename
 * or a change of role.
 */
export type MessageRecord = {
  id: string;
  ticket: string;
  /** 'text' for something somebody said, 'system' for something that happened. */
  kind: "text" | "system";
  /**
   * How far this line has got: how many of the people it was written for have
   * had the thread open since. `of` is the raiser plus whoever holds the
   * ticket, minus the author.
   */
  seen: { by: number; of: number };
  /** Which kind of thing happened, on a system line. */
  event:
    | "raised"
    | "edited"
    | "assignment"
    | "resolved"
    | "approved"
    | "rejected"
    | "auto-approved"
    | "escalated"
    | "escalation.handled"
    | null;
  author: { id: string; name: string };
  /** Where the author sits today - named in the menu on their message. */
  authorDepartments: { id: string; name: string; role?: string; designation?: string }[];
  authorUnits: { id: string; name: string }[];
  /**
   * The author's title in this thread: in the department working the ticket,
   * or the one it came from, whichever they sit in.
   */
  authorDesignation?: string;
  /** The line this one answers, quoted. */
  replyTo: MessageQuote | null;
  authorRole: Role;
  /** Which end of the ticket it was written from. */
  side: "raiser" | "department";
  body: string;
  /** The people the line names with "@", as written - the words to mark. */
  mentions: { id: string; name: string }[];
  attachment: MessageAttachment | null;
  /** Set when the author has corrected it since. */
  editedAt: string | null;
  /** Withdrawn by its author. The body is empty unless you are an admin. */
  deleted: boolean;
  deletedAt: string | null;
  /** Who withdrew it - admins only. */
  deletedBy: string | null;
  /** Earlier versions of an edited line - admins only. */
  revisions: { body: string; replacedAt: string }[];
  /** True when you are being shown something the rest of the thread cannot. */
  adminOnly: boolean;
  createdAt: string;
};

/**
 * When one line was said, and who has had the thread open since. "Seen" is
 * what a thread read top to bottom can honestly claim: the conversation was
 * open after this was written.
 */
export type MessageInfo = {
  sentAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  seenBy: { id: string; name: string; at: string }[];
};

export function messageInfo(ticketId: string, messageId: string, signal?: AbortSignal) {
  return api<{ info: MessageInfo }>(`/tickets/${ticketId}/messages/${messageId}/info`, {
    signal,
  }).then((data) => data.info);
}

/** The whole thread, oldest first - the order a chat is read in. */
export function listMessages(ticketId: string, signal?: AbortSignal) {
  return api<{ messages: MessageRecord[] }>(`/tickets/${ticketId}/messages`, { signal }).then(
    (data) => data.messages,
  );
}

/**
 * The same thread, asked for again. The tag from the last answer goes back up;
 * a thread nobody has written to answers 304 with no body, so an open chat
 * costs one small request a tick and repaints nothing.
 */
export function revalidateMessages(ticketId: string, etag: string | null, signal?: AbortSignal) {
  return apiRevalidate<{ messages: MessageRecord[] }>(
    `/tickets/${ticketId}/messages`,
    etag,
    signal,
  );
}

/**
 * Says something on a ticket. `attachment` names a file already uploaded to
 * storage - the API checks it landed before it writes the message.
 */
/** Corrects a line you wrote. The previous text is kept for admins. */
export function editMessage(
  ticketId: string,
  messageId: string,
  body: string,
  /** People newly named in the corrected text; the ones still written are kept. */
  mentions?: string[],
) {
  return api<{ message: MessageRecord }>(`/tickets/${ticketId}/messages/${messageId}`, {
    method: "PATCH",
    body: { body, ...(mentions?.length ? { mentions } : {}) },
  }).then((data) => data.message);
}

/**
 * Withdraws a line you wrote. Nothing is erased: the thread shows that a
 * message was deleted, and an admin can still read it.
 */
export function deleteMessage(ticketId: string, messageId: string) {
  return api<{ message: MessageRecord }>(`/tickets/${ticketId}/messages/${messageId}`, {
    method: "DELETE",
  }).then((data) => data.message);
}

export function sendMessage(
  ticketId: string,
  body: string,
  attachment?: { kind: AttachmentKind; key: string; durationMs?: number; filename?: string },
  /** The message being answered, if this is a reply. */
  replyTo?: string | null,
  /** The people named with "@" - the server checks each can read the ticket. */
  mentions?: string[],
) {
  return api<{ message: MessageRecord }>(`/tickets/${ticketId}/messages`, {
    method: "POST",
    body: {
      body,
      ...(attachment ? { attachment } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(mentions?.length ? { mentions } : {}),
    },
  }).then((data) => data.message);
}

/** One thing the thread has shared: a photo, a video or a document. */
export type SharedFile = {
  id: string;
  /** Sent in the conversation, or attached when the request was raised. */
  from: "chat" | "request";
  kind: "image" | "video" | "file";
  /** The name it was sent with - what a search for it matches on. */
  filename: string;
  mimeType: string;
  size: number;
  /** Signed for the hour; never stored. */
  url: string;
  by: { id: string; name: string };
  createdAt: string;
};

/** One web address somebody posted, with the line it was said in. */
export type SharedLink = {
  id: string;
  messageId: string;
  url: string;
  context: string;
  by: { id: string; name: string };
  createdAt: string;
};

/**
 * Everything a ticket's thread has shared, grouped the way a phone groups it.
 * `q` narrows by the words of a file's name, so "digital salary" finds
 * "aims-digital-salary-list.xlsx".
 */
export function listMedia(ticketId: string, q = "", signal?: AbortSignal) {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return api<{ media: SharedFile[]; documents: SharedFile[]; links: SharedLink[] }>(
    `/tickets/${ticketId}/media${query}`,
    { signal },
  );
}
