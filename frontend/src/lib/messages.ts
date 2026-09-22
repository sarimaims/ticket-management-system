import { api, apiRevalidate } from "./api";
import type { Role } from "./auth";
import type { AttachmentKind } from "./uploads";

/**
 * A photo or a voice note hanging off a message. `url` is signed by the API on
 * every read and expires within the hour, so it is never stored or shared.
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
 * One line of a ticket's conversation. Name and standing are the author's at
 * the time of writing, so an old message still reads correctly after a rename
 * or a change of role.
 */
export type MessageRecord = {
  id: string;
  ticket: string;
  author: { id: string; name: string };
  authorRole: Role;
  /** Which end of the ticket it was written from. */
  side: "raiser" | "department";
  body: string;
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
export function editMessage(ticketId: string, messageId: string, body: string) {
  return api<{ message: MessageRecord }>(`/tickets/${ticketId}/messages/${messageId}`, {
    method: "PATCH",
    body: { body },
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
) {
  return api<{ message: MessageRecord }>(`/tickets/${ticketId}/messages`, {
    method: "POST",
    body: { body, ...(attachment ? { attachment } : {}) },
  }).then((data) => data.message);
}
