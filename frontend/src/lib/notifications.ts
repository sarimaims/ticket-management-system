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

export type NotificationRecord = {
  id: string;
  type: NotificationType;
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
