import { api } from "./api";

export type NotificationType =
  | "ticket.new"
  | "ticket.updated"
  | "ticket.edited"
  | "ticket.message"
  /** Somebody is asking you to take a ticket on. */
  | "ticket.handover"
  /** They answered the one you sent. */
  | "ticket.handover.answered"
  | "ticket.deleted";

/**
 * What actually happened, under the broad type.
 *
 * `ticket.updated` covers finishing, calling off, re-promising and handing on;
 * this is what tells them apart, and what the feed colours by. Null on rows
 * written before it existed, which fall back to the type.
 */
export type NotificationEvent =
  | "raised"
  | "completed"
  | "cancelled"
  | "status"
  | "promise"
  | "assigned"
  | "moved"
  | "edited"
  | "message"
  | "handover"
  | "handover.answered"
  | "deleted";

export type NotificationRecord = {
  id: string;
  type: NotificationType;
  event: NotificationEvent | null;
  ticket: string | null;
  ticketNumber: string;
  title: string;
  body: string;
  actorName: string;
  departmentName: string;
  /**
   * Whether this copy went to the person who raised the ticket. The same event
   * is written once per recipient and the two sides read it on different
   * pages, so the link has to know which copy it is looking at. Null on rows
   * written before the flag existed.
   */
  forRaiser: boolean | null;
  read: boolean;
  createdAt: string;
};

export function listNotifications(signal?: AbortSignal) {
  return api<{ notifications: NotificationRecord[]; unread: number }>("/notifications", { signal });
}

/** Marks the given notifications read, or every one of them when ids is omitted. */
export function markNotificationsRead(ids?: string[]) {
  return api<{ marked: number; unread: number }>("/notifications/read", {
    method: "PATCH",
    body: ids ? { ids } : {},
  });
}

export function clearNotifications() {
  return api<{ cleared: number }>("/notifications", { method: "DELETE" });
}
