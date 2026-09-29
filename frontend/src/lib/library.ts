import { api } from "./api";
import type { TicketStatus } from "./types";

/** Which shelf of the library an item sits on. */
export type LibraryType = "image" | "video" | "document" | "link";

/** The ticket an item came from: enough to name it and open it. */
export type LibraryTicket = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  department: string;
  raisedById: string;
};

type Common = {
  id: string;
  /** Sent in the conversation, or attached / written when the request was raised. */
  from: "chat" | "request";
  by: { id: string; name: string };
  createdAt: string;
  ticket: LibraryTicket;
};

/** A photo, a video or a document. Both links are signed for the hour. */
export type LibraryFile = Common & {
  type: "image" | "video" | "document";
  filename: string;
  mimeType: string;
  size: number;
  /** Opens it where the browser can show it. */
  url: string;
  /** Arrives as a download under the name it was sent with. */
  downloadUrl: string;
};

/** A web address somebody posted, with the sentence it was posted in. */
export type LibraryLink = Common & {
  type: "link";
  url: string;
  context: string;
  messageId: string | null;
};

export type LibraryItem = LibraryFile | LibraryLink;

export type Library = {
  counts: Record<LibraryType, number>;
  /** How many tickets the items were drawn from. */
  tickets: number;
  items: LibraryItem[];
};

/**
 * Every file, photo, video and link across the tickets this person can see.
 * `q` is matched word by word against the name, the ticket's number and
 * subject, the sender and the department.
 */
export function listLibrary(q = "", signal?: AbortSignal) {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return api<Library & { success: boolean }>(`/tickets/media${query}`, { signal });
}
