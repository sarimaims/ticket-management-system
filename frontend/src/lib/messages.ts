import { api, apiRevalidate } from "./api";
import type { Role } from "./auth";

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

export function sendMessage(ticketId: string, body: string) {
  return api<{ message: MessageRecord }>(`/tickets/${ticketId}/messages`, {
    method: "POST",
    body: { body },
  }).then((data) => data.message);
}
