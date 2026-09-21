"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building, CheckCircle2, Paperclip, ShieldCheck, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { DateField } from "@/components/tickets/date-field";
import { listDepartmentOptions, type DepartmentOption } from "@/lib/departments";
import { listUnitOptions, type UnitOption } from "@/lib/units";
import { createTicket, type TicketRecord } from "@/lib/tickets";
import { useAuth } from "@/components/auth/auth-provider";
import { isAdmin, ROLE_LABEL } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { TicketPriority } from "@/lib/types";

const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];

/** The boxes that must be filled, in the order they appear on the page. */
const REQUIRED = [
  { key: "target", label: "Request To Department", id: "target-departments" },
  { key: "subject", label: "Subject", id: "subject" },
  { key: "description", label: "Description", id: "description" },
  { key: "completionDate", label: "Deadline", id: "completion-date" },
] as const;

type RequiredKey = (typeof REQUIRED)[number]["key"];

const PRIORITY_TONE: Record<TicketPriority, { dot: string; selected: string }> = {
  Low: { dot: "bg-priority-low-dot", selected: "bg-priority-low-bg text-priority-low-fg" },
  Medium: {
    dot: "bg-priority-medium-dot",
    selected: "bg-priority-medium-bg text-priority-medium-fg",
  },
  High: { dot: "bg-priority-high-dot", selected: "bg-priority-high-bg text-priority-high-fg" },
  Critical: {
    dot: "bg-priority-critical-dot",
    selected: "bg-priority-critical-bg text-priority-critical-fg",
  },
};

/**
 * Four choices, so they are all on show: one click instead of open-read-pick,
 * and the colour of the answer is visible before it is given.
 */
function PriorityPicker({
  value,
  onChange,
}: {
  value: TicketPriority;
  onChange: (value: TicketPriority) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Priority"
      className="flex w-full gap-1 rounded-field border border-line-strong bg-surface p-1"
    >
      {PRIORITIES.map((level) => {
        const selected = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(level)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold transition-colors",
              selected ? PRIORITY_TONE[level].selected : "text-ink-500 hover:bg-ink-50",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_TONE[level].dot)} />
            {level}
          </button>
        );
      })}
    </div>
  );
}

/** Each step of the form is its own box, so the page reads as three decisions. */
function Step({
  title,
  optional,
  children,
}: {
  title: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "p-5",
        optional && "border-dashed bg-ink-50/50 shadow-none",
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-bold text-ink-900">{title}</h2>
        {optional && (
          <span className="rounded-full bg-ink-200/70 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
            Optional
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

/** The one unit this person belongs to, or "" when it is none or several. */
function ownUnit(session: ReturnType<typeof useAuth>["session"]) {
  const units = new Set(
    (session?.departments ?? []).map((membership) => membership.unit?.id).filter(Boolean),
  );
  return units.size === 1 ? [...units][0]! : "";
}

export function TicketForm() {
  const toast = useToast();
  const { session } = useAuth();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  /** Until this clears, "no departments" would be a lie rather than a fact. */
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [units, setUnits] = useState<UnitOption[]>([]);
  /**
   * Which unit's departments are on offer. Empty means every unit. It starts
   * on the raiser's own unit, because that is where most requests go; someone
   * in several units, or in none, starts on "All units".
   */
  const [targetUnit, setTargetUnit] = useState(() => ownUnit(session));
  const [targetDepts, setTargetDepts] = useState<string[]>([]);
  // Someone speaks for every department they belong to by default; they can
  // narrow it before raising.
  const [fromDepts, setFromDepts] = useState<string[]>(
    () => (session?.departments ?? []).map((membership) => membership.id),
  );
  const [priority, setPriority] = useState<TicketPriority>("Medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [project, setProject] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [missing, setMissing] = useState<RequiredKey[]>([]);
  const [pending, setPending] = useState(false);
  const [raised, setRaised] = useState<TicketRecord[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      listDepartmentOptions(controller.signal).then(setDepartments),
      listUnitOptions(controller.signal).then(setUnits),
    ]).then(() => {
      if (!controller.signal.aborted) setLoadingOptions(false);
    });
    return () => controller.abort();
  }, []);

  const clear = (key: RequiredKey) =>
    setMissing((current) => current.filter((item) => item !== key));

  const addFiles = (list: FileList | null) => {
    if (list) setFiles((current) => [...current, ...Array.from(list)]);
  };

  const selected = departments.filter((department) => targetDepts.includes(department.id));

  // You can only ask on behalf of a department you are actually in.
  const myDepartments = (session?.departments ?? []).map((membership) => ({
    value: membership.id,
    label: membership.name ?? "Department",
  }));

  const inUnit = targetUnit
    ? departments.filter((department) => department.unit?.id === targetUnit)
    : departments;

  const allDepartments = inUnit.map((department) => ({
    value: department.id,
    label:
      // With every unit on offer the name alone can be ambiguous, so the unit
      // rides along; inside one unit that would just be repetition.
      !targetUnit && units.length > 1 && department.unit?.name
        ? `${department.name} · ${department.unit.name}`
        : department.name,
  }));

  /**
   * Switching unit drops anything picked that the new unit does not hold -
   * done here rather than in an effect, so the list and the chips never
   * disagree for a render.
   */
  const chooseUnit = (unitId: string) => {
    setTargetUnit(unitId);
    if (!unitId) return;
    const allowed = new Set(
      departments
        .filter((department) => department.unit?.id === unitId)
        .map((department) => department.id),
    );
    setTargetDepts((current) => current.filter((id) => allowed.has(id)));
  };

  const manager = isAdmin(session);
  const hasOwnDepartments = myDepartments.length > 0;

  const reset = () => {
    setTargetDepts([]);
    setTargetUnit(ownUnit(session));
    setFromDepts([]);
    setPriority("Medium");
    setSubject("");
    setDescription("");
    setCompletionDate("");
    setProject("");
    setFiles([]);
    setMissing([]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const filled: Record<RequiredKey, boolean> = {
      target: targetDepts.length > 0,
      subject: Boolean(subject.trim()),
      description: Boolean(description.trim()),
      completionDate: Boolean(completionDate),
    };
    const gaps = REQUIRED.filter((field) => !filled[field.key]);

    if (gaps.length > 0) {
      setMissing(gaps.map((field) => field.key));
      toast.error(
        gaps.length === 1
          ? `${gaps[0].label} is required`
          : `${gaps.length} required fields are missing`,
        // Naming them only helps when there is more than one.
        gaps.length === 1 ? undefined : gaps.map((field) => field.label).join(", "),
      );
      // Put the reader in front of the first empty box.
      const first = document.getElementById(gaps[0].id);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus({ preventScroll: true });
      return;
    }

    setMissing([]);
    setPending(true);
    try {
      const tickets = await createTicket({
        departments: targetDepts,
        fromDepartments: fromDepts,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        deadline: completionDate,
        project: project.trim() || undefined,
      });
      setRaised(tickets);
      reset();
      toast.success(
        tickets.length === 1
          ? `Ticket #${tickets[0].number} created`
          : `${tickets.length} tickets created`,
        tickets.map((item) => item.department.name).join(", "),
      );
    } catch (caught) {
      toast.error("Could not create the ticket", errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="mx-auto max-w-3xl space-y-4" onSubmit={submit} noValidate>
      <Step title="Where it goes">
        {/* From -> To reads as one sentence, so the two sit on one line with
            the direction drawn between them. A manager belongs to no
            department, so there is nothing to ask from and the field is not
            rendered at all. */}
        <div
          className={cn(
            "grid gap-4",
            hasOwnDepartments && "sm:grid-cols-[1fr_auto_1fr] sm:items-end sm:gap-3",
          )}
        >
          <div className="sm:col-span-full">
            <Field label="Request To Unit" hint="(narrows the departments below)" htmlFor="target-unit">
              <Select
                id="target-unit"
                icon={<Building className="text-ink-500" />}
                value={targetUnit}
                onChange={(event) => chooseUnit(event.target.value)}
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {hasOwnDepartments && (
            <>
              <Field
                label="Request From Department"
                hint="(your departments)"
                htmlFor="from-departments"
              >
                <MultiSelect
                  id="from-departments"
                  options={myDepartments}
                  value={fromDepts}
                  onChange={setFromDepts}
                  placeholder="Select one or more"
                />
              </Field>

              <div className="hidden h-12 items-center justify-center sm:flex">
                <ArrowRight className="size-4 text-ink-300" />
              </div>
            </>
          )}

          <Field label="Request To Department" required htmlFor="target-departments">
            <MultiSelect
              id="target-departments"
              options={allDepartments}
              value={targetDepts}
              onChange={(value) => {
                setTargetDepts(value);
                if (value.length > 0) clear("target");
              }}
              placeholder="Select one or more"
              emptyMessage={
                targetUnit ? "Nothing in this unit yet" : "No departments yet"
              }
              invalid={missing.includes("target")}
            />
            {loadingOptions && (
              <p className="mt-1.5 flex items-center gap-2 text-xs text-ink-400">
                <span className="size-3 animate-spin rounded-full border-2 border-ink-200 border-t-ink-400" />
                Loading departments…
              </p>
            )}

            {!loadingOptions && allDepartments.length === 0 && targetUnit && (
              <p className="mt-1.5 text-xs text-ink-400">
                That unit has no departments yet. Pick another, or choose{" "}
                <span className="font-semibold text-ink-500">All units</span>.
              </p>
            )}

            {!loadingOptions && departments.length === 0 && (
              <p className="mt-1.5 text-xs text-ink-400">
                No departments exist yet.{" "}
                {manager ? (
                  <Link
                    href="/departments"
                    className="font-semibold text-brand-600 underline underline-offset-2"
                  >
                    Create one first
                  </Link>
                ) : (
                  "Ask an admin to create one."
                )}
              </p>
            )}
          </Field>
        </div>

        {!hasOwnDepartments && (
          <p className="mt-3 flex items-start gap-2 rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
            <ShieldCheck className="mt-px size-4 shrink-0 text-ink-400" />
            {manager ? (
              <span>
                Raised at{" "}
                <span className="font-semibold text-ink-700">
                  {ROLE_LABEL[session?.role ?? "admin"]}
                </span>{" "}
                level. The department you pick sees where it came from.
              </span>
            ) : (
              <span>You are not in a department yet, so this goes out in your name only.</span>
            )}
          </p>
        )}

        {/* Who can see it is a property of the department, so say so up front. */}
        {selected.length > 0 && (
          <div className="mt-4 rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
            <p className="flex items-center gap-2">
              <Users className="size-4 shrink-0 text-ink-400" />
              {selected.length === 1
                ? "One ticket will be raised, visible only to:"
                : `${selected.length} separate tickets will be raised, each visible only to:`}
            </p>
            <ul className="mt-1.5 space-y-0.5 pl-6">
              {selected.map((department) => (
                <li key={department.id}>
                  <span className="font-semibold text-ink-700">{department.name}</span> · its head
                  and team
                </li>
              ))}
            </ul>
          </div>
        )}
      </Step>

      <Step title="What you need">
        <div className="space-y-4">
          <div className="grid gap-4">
            <Field label="Subject" required htmlFor="subject">
              <Input
                id="subject"
                placeholder="e.g. Web developer required"
                invalid={missing.includes("subject")}
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value);
                  clear("subject");
                }}
              />
            </Field>
          </div>

          <Field label="Description" required htmlFor="description">
            <Textarea
              id="description"
              maxLength={1000}
              className="min-h-32"
              invalid={missing.includes("description")}
              placeholder="We need a Node.js developer for the customer portal. Please start the hiring process and share a timeline for candidate availability."
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                clear("description");
              }}
            />
          </Field>

          {/* When it is needed and how urgent it is are the same judgement,
              so they sit side by side. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Deadline"
              required
              help="The date you need this done by."
              htmlFor="completion-date"
            >
              <DateField
                id="completion-date"
                value={completionDate}
                onChange={(value) => {
                  setCompletionDate(value);
                  if (value) clear("completionDate");
                }}
                clearable={false}
                placeholder="Select a date"
                invalid={missing.includes("completionDate")}
              />
            </Field>

            <div>
              <Label required className="mb-1">
                Priority
              </Label>
              <p className="mb-2 text-xs text-ink-400">How urgent this is.</p>
              <PriorityPicker value={priority} onChange={setPriority} />
            </div>
          </div>
        </div>
      </Step>

      <Step title="Extra details" optional>
        <div className="space-y-4">
          <Field label="Related project" htmlFor="project">
            <Input
              id="project"
              placeholder="e.g. FlowDesk Portal"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-semibold text-ink-800">Attachments</p>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
              className={cn(
                "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-field border border-dashed px-4 py-4 text-center text-sm transition-colors",
                dragging ? "border-brand-400 bg-brand-50" : "border-line-strong bg-surface",
              )}
            >
              <Paperclip className="size-4 text-ink-400" />
              <span className="text-ink-600">
                Drag files here or{" "}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700"
                >
                  browse
                </button>
              </span>
              <span className="text-xs text-ink-400">PDF, DOC, JPG, PNG · max 10MB</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(event) => addFiles(event.target.files)}
              />
            </div>

            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((file, index) => (
                  <li
                    key={file.name + index}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-1.5 text-sm"
                  >
                    <span className="truncate font-medium text-ink-700">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      className="text-ink-400 transition-colors hover:text-brand-600"
                      aria-label={"Remove " + file.name}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Step>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={reset}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create Ticket"}
        </Button>
      </div>

      <TicketRaisedModal tickets={raised} onClose={() => setRaised(null)} />
    </form>
  );
}

/** Confirms the ticket exists and says who now has it. */
function TicketRaisedModal({
  tickets,
  onClose,
}: {
  tickets: TicketRecord[] | null;
  onClose: () => void;
}) {
  const many = (tickets?.length ?? 0) > 1;

  return (
    <Modal
      open={tickets !== null && tickets.length > 0}
      onClose={onClose}
      title={many ? "Tickets raised" : "Ticket raised"}
      description={
        many
          ? "Each department got its own ticket and can resolve it independently."
          : "It is now in that department's queue."
      }
      className="max-w-md"
    >
      {tickets && tickets.length > 0 && (
        <>
          <div className="flex items-start gap-3 rounded-field bg-status-completed-bg px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-status-completed-fg" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-status-completed-fg">
                {tickets.map((ticket) => ticket.number).join(", ")} created
              </p>
              <p className="mt-0.5 text-sm text-ink-600">{tickets[0].subject}</p>
            </div>
          </div>

          <dl className="mt-4 divide-y divide-line text-sm">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="flex justify-between gap-4 py-2">
                <dt className="text-ink-500">{ticket.number}</dt>
                <dd className="font-semibold text-ink-900">{ticket.department.name}</dd>
              </div>
            ))}
            {tickets[0].fromDepartments.length > 0 && (
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-500">Raised on behalf of</dt>
                <dd className="text-right font-semibold text-ink-900">
                  {tickets[0].fromDepartments.map((item) => item.name).join(", ")}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-500">Priority</dt>
              <dd className="font-semibold text-ink-900">{tickets[0].priority}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Raise another
            </Button>
            <Link
              href="/my-requests"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              View my requests
            </Link>
          </div>
        </>
      )}
    </Modal>
  );
}
