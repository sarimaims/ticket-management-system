import { api } from "./api";
import type { Role } from "./auth";

/**
 * One line of a ticket's assignment trail. Names are the people's at the time
 * of the handover, so an old line still reads correctly after a rename.
 */
export type AssignmentRecord = {
  id: string;
  /** Null on the first line: it came from nobody. */
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  by: { id: string | null; name: string; role: Role };
  /** How it got there: raised onto them, or handed over afterwards. */
  kind: "raised" | "reassigned";
  createdAt: string;
};

/** Who has held this ticket, oldest first. */
export function listAssignments(ticketId: string, signal?: AbortSignal) {
  return api<{ assignments: AssignmentRecord[] }>(`/tickets/${ticketId}/assignments`, {
    signal,
  }).then((data) => data.assignments);
}
