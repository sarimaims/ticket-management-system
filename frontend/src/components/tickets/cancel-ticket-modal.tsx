"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { TicketRecord } from "@/lib/tickets";
import { cn } from "@/lib/utils";

/**
 * Calling a ticket off, with the remark that says why.
 *
 * Opened by choosing Cancelled anywhere a status can be set. The remark is
 * required: the person who asked is told the ticket was cancelled, and the
 * reason is the only part of that they can act on.
 */
export function CancelTicketModal({
  ticket,
  pending = false,
  onClose,
  onConfirm,
}: {
  ticket: TicketRecord | null;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);

  const close = () => {
    setReason("");
    setMissing(false);
    onClose();
  };

  const confirm = () => {
    if (reason.trim().length < 3) {
      setMissing(true);
      return;
    }
    onConfirm(reason.trim());
    setReason("");
    setMissing(false);
  };

  return (
    <Modal
      open={ticket !== null}
      onClose={close}
      title={`Cancel #${ticket?.number ?? ""}?`}
      description={ticket?.subject}
      className="max-w-md"
    >
      <label
        htmlFor="cancel-reason"
        className="block text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
      >
        Remarks <span className="text-brand-600">*</span>
      </label>
      <Textarea
        id="cancel-reason"
        value={reason}
        invalid={missing}
        maxLength={400}
        autoFocus
        placeholder="e.g. Already handled over the phone"
        onChange={(event) => {
          setReason(event.target.value);
          if (event.target.value.trim().length >= 3) setMissing(false);
        }}
        className="mt-1 min-h-20 text-[13px]"
      />
      <p className={cn("mt-1 text-xs", missing ? "font-semibold text-brand-600" : "text-ink-500")}>
        {missing
          ? "Say why it is being cancelled."
          : `${ticket?.raisedBy.name ?? "The requester"} is told it was cancelled, with this remark.`}
      </p>

      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={close} disabled={pending}>
          Keep it open
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={pending}>
          {pending ? "Cancelling…" : "Cancel ticket"}
        </Button>
      </div>
    </Modal>
  );
}
