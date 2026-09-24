import { api } from "./api";

/**
 * One person asking another to take a ticket off them.
 *
 * A head reassigns directly; anyone else asks, and the ticket only moves when
 * somebody accepts. See the model on the API for why.
 */
export type HandoverRecord = {
  id: string;
  ticket: string;
  requestedBy: { id: string; name: string };
  to: { id: string; name: string }[];
  note: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  /** Of the people asked, the ones who have already said no. */
  declinedBy: string[];
  createdAt: string;
};

/** Every ask on this ticket, newest first. */
export function listHandovers(ticketId: string, signal?: AbortSignal) {
  return api<{ handovers: HandoverRecord[] }>(`/tickets/${ticketId}/handovers`, { signal }).then(
    (data) => data.handovers,
  );
}

/** Asks these people to take it on. Only somebody already holding it may ask. */
export function askHandover(ticketId: string, to: string[], note?: string) {
  return api<{ handover: HandoverRecord }>(`/tickets/${ticketId}/handovers`, {
    method: "POST",
    body: { to, note },
  }).then((data) => data.handover);
}

/**
 * `accept` moves the ticket, `decline` passes, `cancel` withdraws an ask you
 * sent yourself.
 */
export function answerHandover(
  ticketId: string,
  handoverId: string,
  answer: "accept" | "decline" | "cancel",
) {
  return api<{ handover: HandoverRecord }>(`/tickets/${ticketId}/handovers/${handoverId}`, {
    method: "PATCH",
    body: { answer },
  }).then((data) => data.handover);
}
