import { api } from "./api";
import type { Role } from "./auth";

/**
 * One line of a ticket's assignment trail. Names are the people's at the time
 * of the handover, so an old line still reads correctly after a rename.
 */
export type AssignmentRecord = {
  id: string;
  /** Empty on the first line: it came from nobody. */
  from: { id: string; name: string }[];
  /** Who it sits with after the move. Several, because a ticket can. */
  to: { id: string; name: string }[];
  by: { id: string | null; name: string; role: Role };
  /** How it got there: raised onto them, or handed over afterwards. */
  kind: "raised" | "reassigned";
  createdAt: string;
};

/**
 * Something that happened to the ticket other than a handover: it was raised,
 * retitled, re-dated - or a line of its conversation was corrected or
 * withdrawn. Handovers are in {@link AssignmentRecord} instead, where they
 * carry who it moved between.
 */
export type TicketEvent = {
  id: string;
  event: "raised" | "edited" | "assignment" | "message.edited" | "message.deleted" | null;
  body: string;
  by: { name: string; role: Role };
  createdAt: string;
};

/**
 * One promise about when the ticket will be resolved, and why that date.
 *
 * `previousDate` is what it replaced, so a move reads as a move: the trail is
 * a sequence, not a pile of dates with the last one winning.
 */
export type CommitmentRecord = {
  id: string;
  /** What was promised. Null when the promise was withdrawn. */
  date: string | null;
  /** What it replaced. Null on the first promise. */
  previousDate: string | null;
  kind: "promised" | "extended" | "pulled-in" | "withdrawn";
  reason: string;
  by: { name: string; role: Role };
  createdAt: string;
};

/** Everything that has happened to this ticket, oldest first. */
export function listHistory(ticketId: string, signal?: AbortSignal) {
  return api<{
    assignments: AssignmentRecord[];
    events: TicketEvent[];
    commitments: CommitmentRecord[];
  }>(
    `/tickets/${ticketId}/assignments`,
    { signal },
  );
}
