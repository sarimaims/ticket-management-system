"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building,
  Building2,
  CheckCircle2,
  Inbox,
  Paperclip,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { DateField } from "@/components/tickets/date-field";
import {
  listDepartmentMembers,
  listDepartmentOptions,
  type DepartmentOption,
  type MemberOption,
} from "@/lib/departments";
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
  { key: "target", label: "To — Department", id: "target-departments" },
  { key: "person", label: "To — Person", id: "target-departments" },
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
      className="flex w-full gap-1 rounded-field border border-line-strong bg-surface p-0.5 sm:w-auto"
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
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-3.5",
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
    <Card className={cn("p-4", optional && "border-dashed bg-ink-50/50 shadow-none")}>
      <div className="mb-3 flex items-center gap-2">
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

/**
 * The two ends of a request are the same three questions asked twice, so they
 * are told apart by colour rather than by reading the labels: the side you are
 * asking from is neutral, the side being asked wears the brand.
 */
const ROUTE_TONE = {
  from: { panel: "border-line-strong bg-ink-50/70", badge: "bg-ink-600 text-white" },
  to: { panel: "border-brand-200 bg-brand-50/40", badge: "bg-brand-600 text-white" },
} as const;

function RoutePanel({
  tone,
  label,
  caption,
  icon: Icon,
  children,
}: {
  tone: keyof typeof ROUTE_TONE;
  label: string;
  caption: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const style = ROUTE_TONE[tone];

  return (
    <section className={cn("rounded-card border p-3", style.panel)}>
      <p className="mb-2.5 flex items-center gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", style.badge)}>
          <Icon className="size-4" />
        </span>
        <span className="text-sm font-bold text-ink-900">{label}</span>
        <span className="truncate text-xs text-ink-400">{caption}</span>
      </p>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/** The line drawn between the two panels: across on a wide screen, down on a narrow one. */
function Connector() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center gap-2 lg:flex-col lg:gap-0 lg:self-stretch lg:py-1"
    >
      <span className="h-px flex-1 bg-line lg:h-auto lg:w-px lg:flex-1" />
      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-400 lg:my-2">
        <ArrowRight className="size-3.5 rotate-90 lg:rotate-0" />
      </span>
      <span className="h-px flex-1 bg-line lg:h-auto lg:w-px lg:flex-1" />
    </div>
  );
}

/** The one unit this person belongs to, or "" when it is none or several. */
function ownUnit(session: ReturnType<typeof useAuth>["session"]) {
  const units = new Set(
    (session?.departments ?? []).map((membership) => membership.unit?.id).filter(Boolean),
  );
  return units.size === 1 ? [...units][0]! : "";
}

/** The units this person's own departments sit under, each named once. */
function ownUnitOptions(session: ReturnType<typeof useAuth>["session"]) {
  const byId = new Map<string, string>();
  for (const membership of session?.departments ?? []) {
    if (membership.unit?.id) byId.set(membership.unit.id, membership.unit.name ?? "Unit");
  }
  return [...byId].map(([id, name]) => ({ id, name }));
}

export function TicketForm() {
  const toast = useToast();
  const { session } = useAuth();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);

  // --- the side asking ----------------------------------------------------
  /** Narrows the person's own departments below. Empty means all of theirs. */
  const [fromUnit, setFromUnit] = useState(() => ownUnit(session));
  // Someone speaks for every department they belong to by default; they can
  // narrow it before raising.
  const [fromDepts, setFromDepts] = useState<string[]>(() =>
    (session?.departments ?? []).map((membership) => membership.id),
  );

  // --- the side being asked -----------------------------------------------
  /**
   * Which unit's departments are on offer. Empty means every unit. It starts
   * on the raiser's own unit, because that is where most requests go; someone
   * in several units, or in none, starts on "All units".
   */
  const [targetUnit, setTargetUnit] = useState(() => ownUnit(session));
  const [targetDepts, setTargetDepts] = useState<string[]>([]);
  /** Who should pick it up, per department: `{ departmentId: userId }`. */
  const [people, setPeople] = useState<Record<string, string>>({});
  /** Who is in each department being asked, keyed the same way. */
  const [teams, setTeams] = useState<Record<string, MemberOption[]>>({});

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
    listDepartmentOptions(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));
    listUnitOptions(controller.signal)
      .then(setUnits)
      .catch(() => setUnits([]));
    return () => controller.abort();
  }, []);

  /**
   * The people in every department being asked, fetched together and written
   * in one go.
   *
   * A run that has been superseded is dropped rather than merged, so the
   * pickers can never show a department that is no longer selected - and
   * because the whole map is replaced, nothing has to be cleaned up when one
   * is removed.
   */
  const teamsRun = useRef(0);

  useEffect(() => {
    const run = (teamsRun.current += 1);
    const controller = new AbortController();

    Promise.all(
      targetDepts.map((id) =>
        listDepartmentMembers(id, controller.signal)
          .then((list) => [id, list] as const)
          .catch(() => [id, [] as MemberOption[]] as const),
      ),
    ).then((entries) => {
      if (run === teamsRun.current) setTeams(Object.fromEntries(entries));
    });

    return () => controller.abort();
  }, [targetDepts]);

  const clear = (key: RequiredKey) =>
    setMissing((current) => current.filter((item) => item !== key));

  const addFiles = (list: FileList | null) => {
    if (list) setFiles((current) => [...current, ...Array.from(list)]);
  };

  const selected = departments.filter((department) => targetDepts.includes(department.id));

  // You can only ask on behalf of a department you are actually in.
  const myUnits = ownUnitOptions(session);
  const myDepartments = (session?.departments ?? [])
    .filter((membership) => !fromUnit || membership.unit?.id === fromUnit)
    .map((membership) => ({
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
  const chooseFromUnit = (unitId: string) => {
    setFromUnit(unitId);
    if (!unitId) return;

    const allowed = new Set(
      (session?.departments ?? [])
        .filter((membership) => membership.unit?.id === unitId)
        .map((membership) => membership.id),
    );
    setFromDepts((current) => current.filter((id) => allowed.has(id)));
  };

  const chooseTargetUnit = (unitId: string) => {
    setTargetUnit(unitId);
    if (!unitId) return;

    const allowed = new Set(
      departments
        .filter((department) => department.unit?.id === unitId)
        .map((department) => department.id),
    );
    chooseTargets(targetDepts.filter((id) => allowed.has(id)));
  };

  const chooseTargets = (value: string[]) => {
    setTargetDepts(value);
    // A name belongs to the department it was picked from, so anything no
    // longer being asked takes its name with it.
    setPeople((current) =>
      Object.fromEntries(value.filter((id) => current[id]).map((id) => [id, current[id]])),
    );
    if (value.length > 0) clear("target");
  };

  /** What a department is called, for the label above its own picker. */
  const departmentName = (id: string) =>
    departments.find((department) => department.id === id)?.name ?? "That department";

  const manager = isAdmin(session);
  const hasOwnDepartments = (session?.departments ?? []).length > 0;
  const single = targetDepts.length === 1;

  const reset = () => {
    setTargetDepts([]);
    setTargetUnit(ownUnit(session));
    setPeople({});
    setFromUnit(ownUnit(session));
    setFromDepts((session?.departments ?? []).map((membership) => membership.id));
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
      // Every department being asked has to be handed to somebody by name.
      person: targetDepts.length > 0 && targetDepts.every((id) => people[id]),
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
      // Put the reader in front of the first empty box. A missing person is
      // one of several pickers, so it resolves to the first one left empty.
      const unnamed = targetDepts.find((id) => !people[id]);
      const firstId =
        gaps[0].key === "person" && unnamed ? `person-${unnamed}` : gaps[0].id;

      const first = document.getElementById(firstId);
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
        // Only the departments actually being asked, and only the ones a
        // name was given for.
        assignees: Object.fromEntries(
          targetDepts.filter((id) => people[id]).map((id) => [id, people[id]]),
        ),
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
    <form className="space-y-3" onSubmit={submit} noValidate>
      <Step title="Route the request">
        {/* From -> To reads as one sentence, so the two ends sit side by side
            with the direction drawn between them. */}
        <div className="grid gap-2.5 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
          <RoutePanel tone="from" label="From" caption="who is asking" icon={Building2}>
            {hasOwnDepartments ? (
              <>
                <Field label="Unit" htmlFor="from-unit">
                  <Select
                    id="from-unit"
                    className="h-11"
                    icon={<Building className="text-ink-500" />}
                    value={fromUnit}
                    onChange={(event) => chooseFromUnit(event.target.value)}
                    disabled={myUnits.length < 2}
                  >
                    <option value="">All my units</option>
                    {myUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Department" hint="(yours)" htmlFor="from-departments">
                  <MultiSelect
                    id="from-departments"
                    options={myDepartments}
                    value={fromDepts}
                    onChange={setFromDepts}
                    placeholder="Select one or more"
                    emptyMessage="Nothing in this unit"
                  />
                </Field>
              </>
            ) : (
              /* A manager belongs to no department, so there is nothing to ask
                 from and the two fields would only be empty boxes. */
              <p className="flex items-start gap-2 rounded-field bg-surface px-3 py-2.5 text-xs text-ink-500">
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
                  <span>
                    You are not in a department yet, so this goes out in your name only.
                  </span>
                )}
              </p>
            )}
          </RoutePanel>

          <Connector />

          <RoutePanel tone="to" label="To" caption="who should handle it" icon={Inbox}>
            <Field label="Unit" htmlFor="target-unit">
              <Select
                id="target-unit"
                className="h-11"
                icon={<Building className="text-ink-500" />}
                value={targetUnit}
                onChange={(event) => chooseTargetUnit(event.target.value)}
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Department" required htmlFor="target-departments">
              <MultiSelect
                id="target-departments"
                options={allDepartments}
                value={targetDepts}
                onChange={chooseTargets}
                placeholder="Select one or more"
                emptyMessage={targetUnit ? "Nothing in this unit yet" : "No departments yet"}
                invalid={missing.includes("target")}
              />
              {allDepartments.length === 0 && targetUnit && (
                <p className="mt-1.5 text-xs text-ink-400">
                  That unit has no departments yet. Pick another, or choose{" "}
                  <span className="font-semibold text-ink-500">All units</span>.
                </p>
              )}

              {departments.length === 0 && (
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

            {/* One name per department, because each of them gets its own
                ticket - somebody in Finance cannot hold the copy that went
                to IT. Every one of them is optional. */}
            {targetDepts.length === 0 ? (
              <p className="rounded-field bg-surface px-3 py-2.5 text-xs text-ink-500">
                Choose a department above, then say who should handle it.
              </p>
            ) : (
              <div>
                <Label required htmlFor={`person-${targetDepts[0]}`}>
                  {single ? "Person" : "Person, per department"}
                </Label>

                <div className="space-y-2.5">
                  {targetDepts.map((id) => {
                    const name = departmentName(id);
                    // Undefined while it is still being fetched; empty once it
                    // has arrived and there is nobody in there.
                    const list = teams[id];

                    return (
                      <div key={id}>
                        {!single && (
                          <p className="mb-1 truncate text-xs font-semibold text-ink-500">{name}</p>
                        )}
                        <Select
                          id={`person-${id}`}
                          className={cn(
                            "h-11",
                            missing.includes("person") &&
                              !people[id] &&
                              "border-brand-400 bg-brand-50/40",
                          )}
                          icon={<UserRound className="text-ink-500" />}
                          aria-label={`Who should handle it in ${name}`}
                          value={people[id] ?? ""}
                          onChange={(event) => {
                            setPeople((current) => ({ ...current, [id]: event.target.value }));
                            clear("person");
                          }}
                          disabled={!list || list.length === 0}
                        >
                          {/* A prompt rather than a choice: the ticket has to
                              land on a named person. */}
                          <option value="" disabled>
                            {list === undefined
                              ? "Loading..."
                              : list.length === 0
                                ? `Nobody in ${name} yet`
                                : "Choose a person"}
                          </option>
                          {(list ?? []).map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name} ({member.departmentRole})
                            </option>
                          ))}
                        </Select>

                        {list?.length === 0 && (
                          <p className="mt-1 text-xs font-medium text-brand-600">
                            Nobody is in {name} yet, so it cannot be asked. Remove it above, or add
                            someone to the department first.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="mt-1.5 text-xs text-ink-400">
                  It lands on them. Whoever holds it can hand it to someone else in the
                  department, and every handover is kept on the ticket.
                </p>
              </div>
            )}
          </RoutePanel>
        </div>

        <div className="mt-3">
          <Label required>Priority</Label>
          <PriorityPicker value={priority} onChange={setPriority} />
        </div>

        {/* Who can see it is a property of the department, so say so up front. */}
        {selected.length > 0 && (
          <div className="mt-3 rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
            <p className="flex items-center gap-2">
              <Users className="size-4 shrink-0 text-ink-400" />
              {selected.length === 1
                ? "One ticket will be raised, visible only to:"
                : `${selected.length} separate tickets will be raised, each visible only to:`}
            </p>
            <ul className="mt-1.5 space-y-0.5 pl-6">
              {selected.map((department) => {
                const who = teams[department.id]?.find(
                  (member) => member.id === people[department.id],
                )?.name;

                return (
                  <li key={department.id}>
                    <span className="font-semibold text-ink-700">{department.name}</span> · its head
                    and team
                    {who ? (
                      <>
                        , landing on <span className="font-semibold text-ink-700">{who}</span>
                      </>
                    ) : (
                      <span className="text-brand-600">, nobody chosen yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Step>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <Step title="What you need">
          <div className="space-y-3">
            {/* The two short answers share a row; the long one gets its own. */}
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
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

              <Field label="Deadline" required hint="(needed by)" htmlFor="completion-date">
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
            </div>

            <Field label="Description" required htmlFor="description">
              <Textarea
                id="description"
                maxLength={1000}
                className="min-h-24"
                invalid={missing.includes("description")}
                placeholder="We need a Node.js developer for the customer portal. Please start the hiring process and share a timeline for candidate availability."
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  clear("description");
                }}
              />
            </Field>
          </div>
        </Step>

        <Step title="Extra details" optional>
          <div className="space-y-3">
            <Field label="Related project" htmlFor="project">
              <Input
                id="project"
                placeholder="e.g. FlowDesk Portal"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              />
            </Field>

            <div>
              <p className="mb-1.5 text-sm font-semibold text-ink-800">Attachments</p>

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
                  "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-field border border-dashed px-4 py-3 text-center text-sm transition-colors",
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
      </div>

      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
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
            {tickets[0].assignee && (
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-500">Addressed to</dt>
                <dd className="font-semibold text-ink-900">{tickets[0].assignee.name}</dd>
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
