import { api } from "./api";

export type NotificationType = "ticket.new" | "ticket.updated" | "ticket.edited";

export type NotificationRecord = {
  id: string;
  type: NotificationType;
  ticket: string | null;
  ticketNumber: string;
  title: string;
  body: string;
  actorName: string;
  departmentName: string;
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
