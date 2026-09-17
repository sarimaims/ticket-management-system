"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Paperclip, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateField } from "@/components/tickets/date-field";
import { listDepartments, type Department } from "@/lib/departments";
import { createTicket, type TicketRecord } from "@/lib/tickets";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { TicketPriority } from "@/lib/types";

const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];

const PRIORITY_DOT: Record<TicketPriority, string> = {
  Low: "bg-priority-low-dot",
  Medium: "bg-priority-medium-dot",
  High: "bg-priority-high-dot",
  Critical: "bg-priority-critical-dot",
};

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

export function TicketForm() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [targetDept, setTargetDept] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("Medium");
  const [requestType, setRequestType] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [project, setProject] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [raised, setRaised] = useState<TicketRecord | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    listDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, []);

  const addFiles = (list: FileList | null) => {
    if (list) setFiles((current) => [...current, ...Array.from(list)]);
  };

  const selected = departments.find((department) => department.id === targetDept);

  const reset = () => {
    setTargetDept("");
    setPriority("Medium");
    setRequestType("");
    setSubject("");
    setDescription("");
    setCompletionDate("");
    setProject("");
    setFiles([]);
    setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!targetDept) return setError("Pick the department this should go to.");
    if (!requestType.trim()) return setError("Request type is required.");
    if (!subject.trim()) return setError("Subject is required.");
    if (!description.trim()) return setError("Description is required.");

    setPending(true);
    try {
      const ticket = await createTicket({
        department: targetDept,
        subject: subject.trim(),
        description: description.trim(),
        requestType: requestType.trim(),
        priority,
        deadline: completionDate || undefined,
        project: project.trim() || undefined,
      });
      setRaised(ticket);
      reset();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="mx-auto max-w-3xl space-y-4" onSubmit={submit} noValidate>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
      <Step title="Where it goes">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Request To Department" required htmlFor="target-department">
            <Select
              id="target-department"
              value={targetDept}
              onChange={(event) => setTargetDept(event.target.value)}
            >
              <option value="">Select a department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" required htmlFor="priority">
            <div className="relative">
              <span
                className={cn(
                  "pointer-events-none absolute top-1/2 left-4 z-10 size-2.5 -translate-y-1/2 rounded-full",
                  PRIORITY_DOT[priority],
                )}
              />
              <Select
                id="priority"
                className="pl-9"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TicketPriority)}
              >
                {PRIORITIES.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </Select>
            </div>
          </Field>
        </div>

        {/* Who can see it is a property of the department, so say so up front. */}
        {selected && (
          <p className="mt-3 flex items-center gap-2 rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
            <Users className="size-4 shrink-0 text-ink-400" />
            Visible to the {selected.headCount === 1 ? "head" : "heads"} and{" "}
            {selected.teamCount} team {selected.teamCount === 1 ? "member" : "members"} of{" "}
            <span className="font-semibold text-ink-700">{selected.name}</span> only.
          </p>
        )}
      </Step>

      <Step title="What you need">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Request Type" required htmlFor="request-type">
              <Input
                id="request-type"
                placeholder="e.g. Recruitment"
                value={requestType}
                onChange={(event) => setRequestType(event.target.value)}
              />
            </Field>

            <Field label="Subject" required htmlFor="subject">
              <Input
                id="subject"
                placeholder="e.g. Web developer required"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Description" required htmlFor="description">
            <Textarea
              id="description"
              maxLength={1000}
              className="min-h-32"
              placeholder="We need a Node.js developer for the CRM project. Please start the hiring process and share a timeline for candidate availability."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      </Step>

      <Step title="Extra details" optional>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred completion date" htmlFor="completion-date">
              <DateField
                id="completion-date"
                value={completionDate}
                onChange={setCompletionDate}
                placeholder="Select a date"
              />
            </Field>

            <Field label="Related project" htmlFor="project">
              <Input
                id="project"
                placeholder="e.g. AIVIN CRM"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              />
            </Field>
          </div>

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

      <TicketRaisedModal ticket={raised} onClose={() => setRaised(null)} />
    </form>
  );
}

/** Confirms the ticket exists and says who now has it. */
function TicketRaisedModal({
  ticket,
  onClose,
}: {
  ticket: TicketRecord | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={ticket !== null}
      onClose={onClose}
      title="Ticket raised"
      description="It is now in that department's queue."
      className="max-w-md"
    >
      {ticket && (
        <>
          <div className="flex items-start gap-3 rounded-field bg-status-completed-bg px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-status-completed-fg" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-status-completed-fg">{ticket.number} created</p>
              <p className="mt-0.5 text-sm text-ink-600">{ticket.subject}</p>
            </div>
          </div>

          <dl className="mt-4 divide-y divide-line text-sm">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-500">Department</dt>
              <dd className="font-semibold text-ink-900">{ticket.department.name}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-500">Request type</dt>
              <dd className="font-semibold text-ink-900">{ticket.requestType}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-500">Priority</dt>
              <dd className="font-semibold text-ink-900">{ticket.priority}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-500">Status</dt>
              <dd className="font-semibold text-ink-900">{ticket.status}</dd>
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
