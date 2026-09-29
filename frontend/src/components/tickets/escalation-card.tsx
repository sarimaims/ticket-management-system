"use client";

import { useState } from "react";
import { ShieldCheck, Siren } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { isSuperAdmin, type Session } from "@/lib/auth";
import { escalateTicket, handleEscalation, type TicketRecord } from "@/lib/tickets";
import { isClosed } from "@/lib/types";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

/** Fired after an escalation opens or closes, so the sidebar count follows. */
export const ESCALATIONS_CHANGED = "flowdesk:escalations-changed";

const escalationsChanged = () => window.dispatchEvent(new Event(ESCALATIONS_CHANGED));

/** The API holds the same limit. */
const MAX_TEXT = 400;

/** "2 h ago", "yesterday": when it was escalated. */
function ago(iso: string | null) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDateOf(iso);
}

/** "2nd", "3rd": how many times it has come back. */
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function Field({
  id,
  label,
  required,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <div className="mt-2">
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-status-escalated-fg">*</span>}
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={MAX_TEXT}
        rows={2}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full resize-none rounded-md border bg-surface px-2.5 py-1.5 text-[12px] text-ink-900 placeholder:text-ink-400 focus:ring-2 focus:outline-none",
          invalid
            ? "border-status-escalated-strong focus:ring-status-escalated-strong/20"
            : "border-line-strong focus:border-status-escalated-fg focus:ring-status-escalated-fg/15",
        )}
      />
    </div>
  );
}

/**
 * Escalation, in the ticket.
 *
 * For anyone but the super admin, a way to put this ticket in front of them
 * when the usual route has stalled - with a reason, because they open it
 * cold. Once escalated, everybody sees that it is, by whom and why; the super
 * admin also gets the button that closes it, with a note on what was done.
 */
export function EscalationCard({
  ticket,
  session,
  onChanged,
}: {
  ticket: TicketRecord;
  session: Session | null;
  onChanged: (ticket: TicketRecord) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  const top = isSuperAdmin(session);
  const escalation = ticket.escalation;
  const open = escalation?.status === "open";

  const reset = () => {
    setWriting(false);
    setText("");
    setMissing(false);
  };

  const escalate = async () => {
    if (text.trim().length < 3) {
      setMissing(true);
      return;
    }
    setPending(true);
    try {
      const saved = await escalateTicket(ticket.id, text.trim());
      onChanged(saved);
      escalationsChanged();
      toast.show({
        tone: "escalation",
        title: `#${ticket.number} escalated`,
        description: "The super admin has been told, with your reason.",
        duration: 8000,
      });
      reset();
    } catch (caught) {
      toast.error(`Could not escalate #${ticket.number}`, errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const handle = async () => {
    setPending(true);
    try {
      const saved = await handleEscalation(ticket.id, text.trim() || undefined);
      onChanged(saved);
      escalationsChanged();
      toast.success(
        `Escalation on #${ticket.number} handled`,
        `${escalation?.byName || "Whoever escalated it"} has been told.`,
      );
      reset();
    } catch (caught) {
      toast.error(`Could not close the escalation`, errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  // ------------------------------------------------------------- open
  if (open && escalation) {
    return (
      <section
        aria-label="Escalated to the super admin"
        className="mt-2 overflow-hidden rounded-lg border border-status-escalated-strong/40 bg-surface shadow-sm shadow-status-escalated-strong/10"
      >
        <div className="flex items-center gap-2 bg-gradient-to-r from-status-escalated-strong to-fuchsia-500 px-2.5 py-1.5 text-white">
          <Siren className="size-3.5 shrink-0" />
          <p className="min-w-0 flex-1 truncate text-[12px] font-bold">
            Escalated to the super admin
          </p>
          {escalation.count > 1 && (
            <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">
              {ordinal(escalation.count)} time
            </span>
          )}
        </div>

        <div className="px-2.5 py-2">
          <p className="text-[11px] text-ink-500">
            by <span className="font-semibold text-ink-800">{escalation.byName || "someone"}</span>
            {escalation.at && (
              <>
                {" "}
                · {ago(escalation.at)} · {formatDateOf(escalation.at)} {formatTime(escalation.at)}
              </>
            )}
          </p>
          <p className="mt-1 rounded-md border-l-2 border-status-escalated-strong bg-status-escalated-bg/50 px-2 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-800">
            {escalation.reason}
          </p>

          {top &&
            (writing ? (
              <>
                <Field
                  id={`escalation-note-${ticket.id}`}
                  label="What was done? (optional)"
                  value={text}
                  onChange={setText}
                  placeholder="e.g. Spoke to the head of Digital, reassigned to Danish"
                />
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void handle()}
                    className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-status-escalated-strong px-3 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    <ShieldCheck className="size-3.5" />
                    {pending ? "Closing…" : "Mark handled"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={reset}
                    className="inline-flex h-8 cursor-pointer items-center rounded-md border border-line-strong px-3 text-[12px] font-semibold text-ink-600 hover:bg-ink-50"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setWriting(true)}
                className="mt-2 inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-status-escalated-strong px-3 text-[12px] font-bold text-white shadow-sm shadow-status-escalated-strong/25 transition-opacity hover:opacity-90"
              >
                <ShieldCheck className="size-3.5" />
                Mark escalation handled
              </button>
            ))}
        </div>
      </section>
    );
  }

  const canEscalate = !top && !isClosed(ticket.status);

  return (
    <>
      {/* How the last one ended, for as long as nobody escalates it again. */}
      {escalation?.status === "handled" && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-status-escalated-bg/60 px-2.5 py-1.5 text-[11px] text-status-escalated-fg">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          <span>
            <span className="font-bold">
              Escalation handled by {escalation.handledByName || "the super admin"}
            </span>
            {escalation.handledAt && (
              <span className="opacity-80"> · {formatDateOf(escalation.handledAt)}</span>
            )}
            {escalation.note && <span className="block text-ink-700">{escalation.note}</span>}
          </span>
        </p>
      )}

      {canEscalate &&
        (writing ? (
          <section className="mt-2 rounded-lg border border-status-escalated-fg/25 bg-status-escalated-bg/40 px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-status-escalated-fg">
              <Siren className="size-3.5" />
              Escalate to the super admin
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              For when the usual route has stalled. They see your reason first.
            </p>
            <Field
              id={`escalation-reason-${ticket.id}`}
              label="Why does this need the super admin?"
              required
              value={text}
              invalid={missing}
              onChange={(value) => {
                setText(value);
                if (value.trim().length >= 3) setMissing(false);
              }}
              placeholder="e.g. No reply from the department in a week, and the deadline is Friday"
            />
            {missing && (
              <p className="mt-0.5 text-[11px] font-medium text-status-escalated-fg">
                Say why, so the super admin knows what is wrong.
              </p>
            )}
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => void escalate()}
                className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-status-escalated-strong px-3 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <Siren className="size-3.5" />
                {pending ? "Escalating…" : "Escalate"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={reset}
                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-line-strong px-3 text-[12px] font-semibold text-ink-600 hover:bg-ink-50"
              >
                Cancel
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setWriting(true)}
            className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-status-escalated-fg/35 px-2.5 py-1.5 text-[12px] font-semibold text-status-escalated-fg transition-colors hover:border-status-escalated-fg/60 hover:bg-status-escalated-bg/50"
          >
            <Siren className="size-3.5" />
            {escalation?.status === "handled" ? "Escalate again" : "Escalate to the super admin"}
          </button>
        ))}
    </>
  );
}
