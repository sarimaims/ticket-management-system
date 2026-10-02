"use client";

import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { APPROVAL_WINDOW_TEXT, type TicketRecord } from "@/lib/tickets";

/**
 * Finishing somebody else's request, said out loud before it happens.
 *
 * Opened wherever a status can be set - the side sheet's picker, its "Mark
 * resolved" button, a row in the table - whenever the person finishing the
 * work is not the one who asked for it. Nothing is completed here: the ticket
 * goes to Resolved and waits for the requester's yes, and silence for the
 * whole window counts as one.
 */
export function ApprovalConfirmModal({
  ticket,
  pending = false,
  onClose,
  onConfirm,
}: {
  ticket: TicketRecord | null;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const requester = ticket?.raisedBy.name ?? "The requester";

  return (
    <Modal
      open={ticket !== null}
      onClose={onClose}
      title={`Send #${ticket?.number ?? ""} for approval?`}
      description={ticket?.subject}
      className="max-w-md"
    >
      <div className="flex gap-3 rounded-lg bg-status-resolved-bg/60 px-3.5 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-resolved-fg" />
        <div className="text-[12.5px] leading-relaxed text-ink-700">
          <p>
            <span className="font-semibold text-ink-900">{requester}</span> raised this ticket, so they
            decide whether it is done. It is marked{" "}
            <span className="font-semibold">Resolved</span> and they are asked to approve it.
          </p>
          <ul className="mt-2 space-y-1 text-[12px] text-ink-600">
            <li>· They approve it: it becomes Completed.</li>
            <li>· They send it back: it returns to In Progress.</li>
            <li>
              · No answer within <span className="font-semibold">{APPROVAL_WINDOW_TEXT}</span>: it
              completes on its own.
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
          Not yet
        </Button>
        <Button type="button" size="sm" onClick={onConfirm} disabled={pending}>
          {pending ? "Sending…" : "Send for approval"}
        </Button>
      </div>
    </Modal>
  );
}
