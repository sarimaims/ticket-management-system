"use client";

import { useState } from "react";
import { CheckCircle2, Clock, ShieldCheck, Undo2 } from "lucide-react";

import { approvalsChanged, timeLeft } from "@/components/tickets/approval-banner";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { answerApproval, type TicketRecord, APPROVAL_WINDOW_TEXT } from "@/lib/tickets";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

/** Long enough to say what is missing; the API holds the same limit. */
const MAX_REASON = 400;

/** "2 h ago", "yesterday": when it was marked done. */
function ago(iso: string | null) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDateOf(iso);
}

/**
 * The sign-off, at the top of the ticket.
 *
 * Four states, one place. While the ticket is Resolved the requester gets the
 * decision - approve it, or send it back with what is missing - and everyone
 * else sees who it is waiting on and for how long. Once answered, the card
 * says how it ended: approved (by whom, or automatically), or sent back with
 * the reason, which stays in front of whoever is doing the work until they
 * resolve it again.
 */
export function ApprovalCard({
  ticket,
  meId,
  onAnswered,
}: {
  ticket: TicketRecord;
  meId?: string;
  onAnswered: (ticket: TicketRecord) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  const mine = ticket.raisedBy.id === meId;
  const resolver = ticket.resolvedByName || "The department";

  const answer = async (decision: "approve" | "reject") => {
    if (decision === "reject" && reason.trim().length < 3) {
      setMissing(true);
      document.getElementById(`reject-reason-${ticket.id}`)?.focus();
      return;
    }

    setPending(true);
    try {
      const saved = await answerApproval(ticket.id, decision, reason.trim() || undefined);
      onAnswered(saved);
      approvalsChanged();
      if (decision === "approve") {
        toast.success(`#${ticket.number} approved`, "Marked Completed. The department has been told.");
      } else {
        toast.show({
          tone: "update",
          title: `#${ticket.number} sent back`,
          description: `Back to In Progress. ${resolver} can see what is missing.`,
        });
      }
      setRejecting(false);
      setReason("");
    } catch (caught) {
      toast.error(`Could not answer #${ticket.number}`, errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  // ---------------------------------------------------------- waiting
  if (ticket.status === "Resolved") {
    const left = timeLeft(ticket.approvalDueAt);

    if (!mine) {
      return (
        <section className="mt-2 flex items-start gap-2 rounded-lg border border-status-resolved-fg/20 bg-status-resolved-bg px-2.5 py-2">
          <Clock className="mt-px size-3.5 shrink-0 text-status-resolved-fg" />
          <p className="text-[12px] leading-snug text-status-resolved-fg">
            <span className="font-bold">
              Waiting for {ticket.raisedBy.name ?? "the requester"} to approve.
            </span>{" "}
            Marked resolved by {resolver} {ago(ticket.resolvedAt)}
            {left && <> · completes on its own in {left}</>}.
          </p>
        </section>
      );
    }

    return (
      <section
        className="mt-2 overflow-hidden rounded-lg border border-status-resolved-strong/40 bg-surface shadow-sm shadow-status-resolved-strong/10"
        aria-label="Approve this request"
      >
        <div className="flex items-center gap-2 bg-gradient-to-r from-status-resolved-strong to-sky-500 px-2.5 py-1.5 text-white">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/80" />
            <span className="relative inline-flex size-2 rounded-full bg-white" />
          </span>
          <ShieldCheck className="size-3.5 shrink-0" />
          <p className="min-w-0 flex-1 truncate text-[12px] font-bold">
            Resolved - waiting for your approval
          </p>
          {left && (
            <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">
              {left} left
            </span>
          )}
        </div>

        <div className="px-2.5 py-2">
          <p className="text-[12px] leading-snug text-ink-700">
            <span className="font-semibold text-ink-900">{resolver}</span> marked this done{" "}
            {ago(ticket.resolvedAt)}. Check the work, then approve it or send it back.
            <span className="mt-0.5 block text-[11px] text-ink-400">
              If you do not answer, it completes on its own
              {ticket.approvalDueAt
                ? ` on ${formatDateOf(ticket.approvalDueAt)} at ${formatTime(ticket.approvalDueAt)}`
                : ` after ${APPROVAL_WINDOW_TEXT}`}
              .
            </span>
          </p>

          {rejecting && (
            <div className="mt-2">
              <label
                htmlFor={`reject-reason-${ticket.id}`}
                className="mb-1 block text-[11px] font-semibold text-ink-700"
              >
                What is still missing?<span className="ml-0.5 text-status-rejected-fg">*</span>
              </label>
              <textarea
                id={`reject-reason-${ticket.id}`}
                value={reason}
                maxLength={MAX_REASON}
                rows={2}
                autoFocus
                onChange={(event) => {
                  setReason(event.target.value);
                  if (event.target.value.trim().length >= 3) setMissing(false);
                }}
                placeholder="e.g. The report still shows last month's numbers"
                className={cn(
                  "w-full resize-none rounded-md border bg-surface px-2.5 py-1.5 text-[12px] text-ink-900 placeholder:text-ink-400 focus:ring-2 focus:outline-none",
                  missing
                    ? "border-status-rejected-fg focus:ring-status-rejected-fg/20"
                    : "border-line-strong focus:border-status-resolved-fg focus:ring-status-resolved-fg/15",
                )}
              />
              {missing && (
                <p className="mt-0.5 text-[11px] font-medium text-status-rejected-fg">
                  Say what is missing, so they know what to fix.
                </p>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5">
            {rejecting ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void answer("reject")}
                  className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-status-rejected-fg px-3 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <Undo2 className="size-3.5" />
                  {pending ? "Sending…" : "Send back to In Progress"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setRejecting(false);
                    setMissing(false);
                  }}
                  className="inline-flex h-8 cursor-pointer items-center rounded-md border border-line-strong px-3 text-[12px] font-semibold text-ink-600 transition-colors hover:bg-ink-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void answer("approve")}
                  className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-status-completed-fg px-3 text-[12px] font-bold text-white shadow-sm shadow-status-completed-fg/20 transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <CheckCircle2 className="size-3.5" />
                  {pending ? "Approving…" : "Approve & complete"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRejecting(true)}
                  className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-status-rejected-fg/30 bg-status-rejected-bg px-3 text-[12px] font-bold text-status-rejected-fg transition-colors hover:border-status-rejected-fg/50"
                >
                  <Undo2 className="size-3.5" />
                  Send back
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------- sent back
  if (ticket.rejectedReason && !["Completed", "Cancelled"].includes(ticket.status)) {
    return (
      <section className="mt-2 rounded-lg border border-status-rejected-fg/20 bg-status-rejected-bg px-2.5 py-2">
        <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-status-rejected-fg uppercase">
          <Undo2 className="size-3" />
          Sent back
          <span className="font-medium normal-case">
            · by {ticket.rejectedByName || "the requester"}
            {ticket.rejectedAt ? ` · ${formatDateOf(ticket.rejectedAt)} ${formatTime(ticket.rejectedAt)}` : ""}
          </span>
        </p>
        <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-800">
          {ticket.rejectedReason}
        </p>
      </section>
    );
  }

  // Approved: said under Dates - who approved it, and when - so nothing here.
  return null;
}
