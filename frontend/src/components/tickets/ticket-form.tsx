"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building, CheckCircle2, Paperclip, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { DateField } from "@/components/tickets/date-field";
import { PriorityPicker } from "@/components/tickets/priority-picker";
import {
  listDepartmentOptions,
  listPeopleOptions,
  type DepartmentOption,
  type PersonOption,
} from "@/lib/departments";
import { listUnitOptions, type UnitOption } from "@/lib/units";
import { createTicket, type TicketRecord } from "@/lib/tickets";
import { useAuth } from "@/components/auth/auth-provider";
import { isAdmin, ROLE_LABEL } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatBytes, TICKET_FILE_LIMITS, uploadTicketFile } from "@/lib/uploads";
import { PriorityBadge, RoleTag } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import type { TicketPriority } from "@/lib/types";

/**
 * The boxes that must be filled, in the order they appear on the page.
 *
 * Naming a person is not among them: leaving it empty leaves the request
 * unassigned in the department's All Tickets for its head to hand out, and
 * being made to pick a stranger out of a list
 * before you can ask a question is the worse failure of the two.
 */
const REQUIRED = [
  { key: "target", label: "To — Department", id: "target-departments" },
  { key: "subject", label: "Subject", id: "subject" },
  { key: "description", label: "Description", id: "description" },
  { key: "completionDate", label: "Deadline", id: "completion-date" },
] as const;

type RequiredKey = (typeof REQUIRED)[number]["key"];

/** One file on its way to storage, and where it has got to. */
type Upload = { percent: number; done: Promise<{ key: string; filename?: string }> };

/** One named person, carrying the department they were picked out of. */
type Picked = {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
};

/**
 * What identifies a choice: the person *and* the department. Somebody in two
 * departments can be asked in either, and those are two different requests.
 */
const pickKey = (personId: string, departmentId: string) => `${personId}:${departmentId}`;

/**
 * One numbered stop on the way down the page.
 *
 * The number is the whole point of the design: three of them in a column say
 * how much there is to do and in what order, before a single label has been
 * read.
 */
function StepCard({
  step,
  title,
  hint,
  optional,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("p-4", optional && "border-dashed bg-ink-50/40 shadow-none")}>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
            optional ? "bg-ink-200 text-ink-600" : "bg-brand-600 text-white",
          )}
        >
          {step}
        </span>
        <h2 className="text-sm font-bold text-ink-900">{title}</h2>
        {optional && (
          <span className="rounded-full bg-ink-200/70 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
            Optional
          </span>
        )}
        {hint && <span className="truncate text-[12px] text-ink-400">{hint}</span>}
      </div>
      {children}
    </Card>
  );
}

/**
 * One question, its name on the left and its answer on the right.
 *
 * Three of these in a column is the whole of step one. The panels this
 * replaced put a border, a tint, a badge and a title around each half of a
 * two-part question, which is four kinds of decoration to say "From" - and
 * nesting a bordered box inside a bordered card inside a bordered field is
 * what made the section read as busy. A hairline between rows says the same
 * thing and leaves the words as the loudest part.
 */
function FormRow({
  label,
  hint,
  required,
  action,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** A control that belongs to the row's title rather than to its answer. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-x-5 gap-y-2 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[8.5rem_1fr]">
      <div className="flex items-baseline justify-between gap-3 sm:block">
        {/* The hint sits beside the name, not under it: stacked, a one-word
            aside looked like a second field. */}
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] font-semibold text-ink-900">
          {label}
          {required && <span className="-ml-1 text-brand-600">*</span>}
          {hint && <span className="text-[11px] font-normal text-ink-400">{hint}</span>}
        </p>
        {action && <div className="sm:hidden">{action}</div>}
      </div>

      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        {action && <div className="hidden shrink-0 sm:block">{action}</div>}
      </div>
    </div>
  );
}

/** No units chosen means every unit, which is what an empty filter should mean. */
const inAny = (units: string[], unitId?: string) =>
  units.length === 0 || (unitId !== undefined && units.includes(unitId));

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

/**
 * What a picked file looks like, before it has gone anywhere.
 *
 * A photo is shown from the browser's own copy, so the preview is there the
 * moment it is chosen; anything else gets a paperclip.
 */
function FileThumb({ file }: { file: File }) {
  const photo = file.type.startsWith("image/");
  const img = useRef<HTMLImageElement>(null);

  // The blob URL is made and let go of here, so it lives exactly as long as
  // the thumbnail does.
  useEffect(() => {
    if (!photo || !img.current) return;
    const url = URL.createObjectURL(file);
    img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, photo]);

  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
    <img ref={img} alt="" className="size-10 shrink-0 rounded-md bg-ink-100 object-cover" />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-ink-100 text-ink-400">
      <Paperclip className="size-4" />
    </span>
  );
}

export function TicketForm() {
  const toast = useToast();
  const { session, features } = useAuth();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);

  // --- the side asking ----------------------------------------------------
  /**
   * Which of the person's own units are in play. Empty means all of them, so
   * someone who works across two can speak for both at once rather than
   * having to pick a side.
   */
  const [fromUnits, setFromUnits] = useState<string[]>(() => {
    const own = ownUnit(session);
    return own ? [own] : [];
  });
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
  const [targetUnits, setTargetUnits] = useState<string[]>(() => {
    const own = ownUnit(session);
    return own ? [own] : [];
  });
  const [targetDepts, setTargetDepts] = useState<string[]>([]);
  /**
   * Who should pick it up. A flat list rather than a map per department: it is
   * what the chips render, and the map the API wants is built from it once, at
   * submit.
   */
  const [picked, setPicked] = useState<Picked[]>([]);
  /**
   * The people on offer, stamped with the departments they were fetched for.
   * Holding the two together is what makes "still loading" a comparison
   * rather than a flag that has to be cleared before every fetch.
   */
  const [fetchedPeople, setFetchedPeople] = useState<{
    scope: string;
    list: PersonOption[];
  } | null>(null);

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
  /** The read-it-back step between filling the form and sending it. */
  const [reviewing, setReviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Until this clears, "no departments" would be a lie rather than a fact. */
  const [loadingOptions, setLoadingOptions] = useState(true);

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

  /**
   * Checked here as well as at the API: a file the bucket would refuse is
   * better refused before it is carried across the network.
   */
  const addFiles = (list: FileList | null) => {
    if (!list) return;

    const rejected: string[] = [];
    const accepted: File[] = [];

    for (const file of Array.from(list)) {
      if (file.size > TICKET_FILE_LIMITS.maxBytes) {
        rejected.push(`${file.name} is ${formatBytes(file.size)}`);
      } else if (file.type && !TICKET_FILE_LIMITS.types.includes(file.type)) {
        rejected.push(`${file.name} is not a PDF, DOC, JPG or PNG`);
      } else {
        accepted.push(file);
      }
    }

    const room = Math.max(0, TICKET_FILE_LIMITS.maxCount - files.length);
    if (accepted.length > room) {
      rejected.push(`only ${TICKET_FILE_LIMITS.maxCount} files can be attached`);
    }
    const kept = accepted.slice(0, room);
    setFiles((current) => [...current, ...kept]);

    // Straight up to storage while the rest of the form is filled in, so
    // raising the ticket is not also waiting on the bytes.
    if (features.attachments) kept.forEach(beginUpload);

    if (rejected.length > 0) toast.error("Some files were not attached", rejected.join(" · "));
  };

  /** 0-100 while the files are going up, null when nothing is in flight. */
  const [uploading, setUploading] = useState<number | null>(null);

  /**
   * Every file's upload, started the moment it was added. Keyed by the File
   * itself, so the same file is only ever sent once however often it is asked
   * for. A failed one drops out and is tried again when the ticket is raised.
   */
  const uploads = useRef(new Map<File, Upload>());
  /** Repaints the bar while the review is waiting on an upload still in flight. */
  const onUploadProgress = useRef<(() => void) | null>(null);

  const beginUpload = (file: File) => {
    const existing = uploads.current.get(file);
    if (existing) return existing;

    const entry: Upload = { percent: 0, done: Promise.resolve({ key: "" }) };
    entry.done = uploadTicketFile(file, {
      onProgress: (percent) => {
        entry.percent = percent;
        onUploadProgress.current?.();
      },
    });
    entry.done.catch(() => {
      if (uploads.current.get(file) === entry) uploads.current.delete(file);
    });
    uploads.current.set(file, entry);
    return entry;
  };

  const selected = departments.filter((department) => targetDepts.includes(department.id));

  // You can only ask on behalf of a department you are actually in.
  const myUnits = ownUnitOptions(session);
  const myDepartments = (session?.departments ?? [])
    // Anything already picked stays on the list even when the unit filter
    // would hide it: an option that disappears takes its name with it, and
    // the chip left behind can only show the raw id.
    .filter(
      (membership) => inAny(fromUnits, membership.unit?.id) || fromDepts.includes(membership.id),
    )
    .map((membership) => ({
      value: membership.id,
      // Their own departments can sit in different units, so once more than
      // one unit is on offer the name alone is not enough to tell them apart.
      label:
        myUnits.length > 1 && membership.unit?.name
          ? `${membership.name ?? "Department"} · ${membership.unit.name}`
          : (membership.name ?? "Department"),
    }));

  // Same again for the side being asked, where it bites harder: naming a
  // person also picks their department, and that department can sit in a unit
  // the filter is not showing.
  const inUnit = departments.filter(
    (department) => inAny(targetUnits, department.unit?.id) || targetDepts.includes(department.id),
  );

  const allDepartments = inUnit.map((department) => ({
    value: department.id,
    label:
      // With every unit on offer the name alone can be ambiguous, so the unit
      // rides along; inside one unit that would just be repetition.
      targetUnits.length !== 1 && units.length > 1 && department.unit?.name
        ? `${department.name} · ${department.unit.name}`
        : department.name,
  }));

  /**
   * Switching unit drops anything picked that the new unit does not hold -
   * done here rather than in an effect, so the list and the chips never
   * disagree for a render.
   */
  const chooseFromUnits = (next: string[]) => {
    setFromUnits(next);
    if (next.length === 0) return;

    const allowed = new Set(
      (session?.departments ?? [])
        .filter((membership) => inAny(next, membership.unit?.id))
        .map((membership) => membership.id),
    );
    setFromDepts((current) => current.filter((id) => allowed.has(id)));
  };

  const chooseTargetUnits = (next: string[]) => {
    setTargetUnits(next);
    if (next.length === 0) return;

    const allowed = new Set(
      departments
        .filter((department) => inAny(next, department.unit?.id))
        .map((department) => department.id),
    );
    chooseTargets(targetDepts.filter((id) => allowed.has(id)));
  };

  const chooseTargets = (value: string[]) => {
    setTargetDepts(value);
    // A name belongs to the department it was picked from, so anything no
    // longer being asked takes its names with it.
    setPicked((current) => current.filter((person) => value.includes(person.departmentId)));
    if (value.length > 0) clear("target");
  };

  // Only the departments being asked are on offer, so the list follows them.
  const peopleScope = targetDepts.join(",");

  useEffect(() => {
    if (!peopleScope) return;

    const controller = new AbortController();

    // Split back out of the joined key rather than closing over the array,
    // which is rebuilt on every render and would restart the fetch each time.
    listPeopleOptions({ departments: peopleScope.split(",") }, controller.signal)
      .then((list) => setFetchedPeople({ scope: peopleScope, list }))
      .catch(() => {
        if (!controller.signal.aborted) setFetchedPeople({ scope: peopleScope, list: [] });
      });

    return () => controller.abort();
  }, [peopleScope]);

  /** Null while a list is on its way; empty when there is nothing to ask for. */
  const people = !peopleScope
    ? []
    : fetchedPeople?.scope === peopleScope
      ? fetchedPeople.list
      : null;

  // Asking yourself is not a request, so the person raising it is left out.
  const peopleOptions = (people ?? [])
    .filter((person) => person.id !== session?.id)
    .map((person) => ({
      value: pickKey(person.id, person.department.id),
      // Somebody in two of the departments being asked shows up twice, so the
      // department rides along to tell the two apart.
      label: targetDepts.length > 1 ? `${person.name} · ${person.department.name}` : person.name,
      badge: <RoleTag role={person.departmentRole} className="px-1.5 py-px text-[10px]" />,
    }));

  const choosePeople = (keys: string[]) => {
    const byKey = new Map(
      (people ?? []).map((person) => [pickKey(person.id, person.department.id), person]),
    );
    const kept = new Map(picked.map((person) => [pickKey(person.id, person.departmentId), person]));

    setPicked(
      keys.flatMap((key): Picked[] => {
        const already = kept.get(key);
        if (already) return [already];
        const person = byKey.get(key);
        if (!person) return [];
        return [
          {
            id: person.id,
            name: person.name,
            departmentId: person.department.id,
            departmentName: person.department.name,
          },
        ];
      }),
    );
  };

  const manager = isAdmin(session);
  const hasOwnDepartments = (session?.departments ?? []).length > 0;

  const reset = () => {
    setTargetDepts([]);
    setTargetUnits(ownUnit(session) ? [ownUnit(session)!] : []);
    setPicked([]);
    setFromUnits(ownUnit(session) ? [ownUnit(session)!] : []);
    setFromDepts((session?.departments ?? []).map((membership) => membership.id));
    setPriority("Medium");
    setSubject("");
    setDescription("");
    setCompletionDate("");
    setProject("");
    setFiles([]);
    uploads.current.clear();
    setMissing([]);
  };

  /**
   * Checks the form and opens the review. Nothing is sent yet: a request that
   * reaches four departments and names six people is worth reading back once,
   * and the only honest place to read it is after it has been filled in.
   */
  /** A department of mine, by name: what the review shows instead of an id. */
  const nameOfMine = (id: string) =>
    (session?.departments ?? []).find((membership) => membership.id === id)?.name ?? "Department";

  const nameOfDepartment = (id: string) => {
    const found = departments.find((department) => department.id === id);
    if (!found) return "Department";
    return found.unit?.name ? `${found.name} · ${found.unit.name}` : found.name;
  };

  const submit = (event: React.FormEvent) => {
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
    setReviewing(true);
  };

  /** The review's own button: uploads, creates, and hands back the tickets. */
  const raise = async () => {
    setPending(true);
    try {
      // The files go straight to storage first; only their keys reach the API,
      // and a ticket is never written pointing at an upload that failed.
      let attachments: { key: string; filename?: string }[] = [];
      if (files.length > 0) {
        if (!features.attachments) {
          throw new Error("File storage is not configured yet, so files cannot be attached.");
        }

        /**
         * Usually already there: each file started up the moment it was
         * added. Anything still in flight - or that failed and is being tried
         * again - shows one bar for the set, the average of their progress.
         */
        const entries = files.map(beginUpload);
        const tick = () =>
          setUploading(
            Math.round(entries.reduce((sum, entry) => sum + entry.percent, 0) / entries.length),
          );
        onUploadProgress.current = tick;
        tick();
        try {
          attachments = await Promise.all(entries.map((entry) => entry.done));
        } finally {
          onUploadProgress.current = null;
          setUploading(null);
        }
      }

      // `{ departmentId: [userId, ...] }`, and only for the departments that
      // were actually named somebody.
      const assignees: Record<string, string[]> = {};
      for (const person of picked) {
        if (!targetDepts.includes(person.departmentId)) continue;
        (assignees[person.departmentId] ??= []).push(person.id);
      }

      const tickets = await createTicket({
        departments: targetDepts,
        fromDepartments: fromDepts,
        assignees,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        deadline: completionDate,
        project: project.trim() || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      setReviewing(false);
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
      setUploading(null);
    }
  };

  return (
    <form className="mx-auto w-full max-w-3xl space-y-3 pb-2" onSubmit={submit} noValidate>
      <StepCard step={1} title="Where it goes">
        <FormRow label="From">
          {hasOwnDepartments ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <MultiSelect
                id="from-unit"
                ariaLabel="Unit you are asking from"
                chipTone="neutral"
                icon={<Building className="text-ink-500" />}
                options={myUnits.map((unit) => ({
                  value: unit.id,
                  label: unit.name,
                }))}
                value={fromUnits}
                onChange={chooseFromUnits}
                placeholder="All my units"
                emptyMessage="You are not in a unit yet"
                disabled={myUnits.length < 2}
              />

              <MultiSelect
                id="from-departments"
                ariaLabel="Departments you are asking from"
                chipTone="neutral"
                options={myDepartments}
                value={fromDepts}
                onChange={setFromDepts}
                placeholder="Your departments"
                emptyMessage="Nothing in this unit"
              />
            </div>
          ) : (
            /* A manager belongs to no department, so there is nothing to ask
               from and the two fields would only be empty boxes. */
            <p className="text-[13px] text-ink-500">
              {manager ? (
                <>
                  Raised at{" "}
                  <span className="font-semibold text-ink-700">
                    {ROLE_LABEL[session?.role ?? "admin"]}
                  </span>{" "}
                  level. The department you pick sees where it came from.
                </>
              ) : (
                "You are not in a department yet, so this goes out in your name only."
              )}
            </p>
          )}
        </FormRow>

        <FormRow label="To" required>
          <div className="grid gap-2 sm:grid-cols-2">
            <MultiSelect
              id="target-unit"
              ariaLabel="Unit to ask"
              chipTone="neutral"
              icon={<Building className="text-ink-500" />}
              options={units.map((unit) => ({
                value: unit.id,
                label: unit.name,
              }))}
              value={targetUnits}
              onChange={chooseTargetUnits}
              placeholder="All units"
              emptyMessage="No units yet"
            />

            <MultiSelect
              id="target-departments"
              ariaLabel="Departments to ask"
              options={allDepartments}
              value={targetDepts}
              onChange={chooseTargets}
              placeholder="Choose departments"
              emptyMessage={
                targetUnits.length > 0 ? "Nothing in those units yet" : "No departments yet"
              }
              invalid={missing.includes("target")}
            />
          </div>

          {/* Until the lists arrive, an empty picker means "not here yet",
              not "nothing exists". */}
          {loadingOptions && (
            <p className="mt-2 flex items-center gap-2 text-[11px] text-ink-400">
              <span className="size-3 animate-spin rounded-full border-2 border-ink-200 border-t-ink-400" />
              Loading departments…
            </p>
          )}

          {!loadingOptions && departments.length === 0 && (
            <p className="mt-2 text-[11px] text-ink-400">
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
        </FormRow>

        {/* Naming somebody is a shortcut, not a gate: the department sees it
            either way, and this only decides whose desk it starts on. */}
        <FormRow label="People" hint="optional">
          <MultiSelect
            id="target-people"
            ariaLabel="People to ask"
            chipTone="neutral"
            icon={<UserPlus className="text-ink-500" />}
            options={peopleOptions}
            value={picked.map((person) => pickKey(person.id, person.departmentId))}
            onChange={choosePeople}
            searchable
            placeholder="Leave it empty and it goes to All Tickets, unassigned"
            emptyMessage={
              targetDepts.length === 0
                ? "Choose a department first"
                : people === null
                  ? "Loading people…"
                  : "Nobody in those departments yet"
            }
            disabled={targetDepts.length === 0}
          />
        </FormRow>

        {/* Who can see it is a property of the department, so say so up front -
            as one quiet line, because it is a consequence of the answers above
            rather than a fourth thing to fill in. */}
        {selected.length > 0 && (
          <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-ink-400">
            {selected.length === 1
              ? "One ticket, seen by "
              : `${selected.length} separate tickets, each seen by `}
            {selected.map((department, index) => {
              const who = picked
                .filter((person) => person.departmentId === department.id)
                .map((person) => person.name)
                .join(", ");

              return (
                <span key={department.id}>
                  {index > 0 && " · "}
                  <span className="font-semibold text-ink-600">{department.name}</span>
                  {who ? <> — starting with {who}</> : <> — unassigned, for its head to hand out</>}
                </span>
              );
            })}
          </p>
        )}
      </StepCard>

      <StepCard step={2} title="What you need">
        <div className="space-y-3">
          {/* The three short answers share a row; the long one gets its own.
              Priority is a dropdown here rather than four segments: beside a
              subject box it was the widest thing in the row and the least
              important question on the form. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_8.5rem_9.5rem]">
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

            <Field label="Priority" required htmlFor="priority">
              <PriorityPicker id="priority" value={priority} onChange={setPriority} />
            </Field>

            <Field label="Deadline" required htmlFor="completion-date">
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
      </StepCard>

      <StepCard step={3} title="Extra details" optional>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <Field label="Related project" htmlFor="project">
            <Input
              id="project"
              placeholder="e.g. FlowDesk Portal"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            />
          </Field>

          <div>
            <Label hint="PDF, DOC, JPG, PNG · max 10MB">Attachments</Label>

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
                // The same height as the box beside it: the two halves of this
                // step are one question each and should look like it.
                "flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed px-3 text-center text-[12px] transition-colors",
                dragging ? "border-brand-400 bg-brand-50" : "border-line-strong bg-surface",
              )}
            >
              <Paperclip className="size-3.5 shrink-0 text-ink-400" />
              <span className="truncate text-ink-500">
                {features.attachments ? (
                  <>
                    Drag files here or{" "}
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700"
                    >
                      browse
                    </button>
                  </>
                ) : (
                  "File storage is not configured yet"
                )}
              </span>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept={TICKET_FILE_LIMITS.accept}
                onChange={(event) => addFiles(event.target.files)}
              />
            </div>

            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((file, index) => (
                  <li
                    key={file.name + index}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface px-2 py-1.5 text-sm"
                  >
                    <FileThumb file={file} />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-700">
                      {file.name}
                      <span className="ml-1.5 font-normal text-ink-400">
                        {formatBytes(file.size)}
                      </span>
                    </span>
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
      </StepCard>

      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={reset}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          Create Ticket
        </Button>
      </div>

      {reviewing && (
        <ReviewModal
          onClose={() => setReviewing(false)}
          onRaise={raise}
          pending={pending}
          uploading={uploading}
          from={fromDepts.map((id) => nameOfMine(id))}
          to={targetDepts.map((id) => nameOfDepartment(id))}
          people={picked}
          priority={priority}
          subject={subject.trim()}
          description={description.trim()}
          deadline={completionDate}
          project={project.trim()}
          files={files}
        />
      )}

      <TicketRaisedModal tickets={raised} onClose={() => setRaised(null)} />
    </form>
  );
}

/** One line of the read-back: a label on the left, the answer on the right. */
function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-ink-900">{children}</dd>
    </div>
  );
}

/**
 * The request as it will be sent, before it is sent.
 *
 * One submit can open several tickets and put named people on them, so the
 * last thing between filling the form and doing that is reading it back. The
 * form is still standing behind this: closing it changes nothing.
 */
function ReviewModal({
  onClose,
  onRaise,
  pending,
  uploading,
  from,
  to,
  people,
  priority,
  subject,
  description,
  deadline,
  project,
  files,
}: {
  onClose: () => void;
  onRaise: () => void;
  pending: boolean;
  uploading: number | null;
  from: string[];
  to: string[];
  people: Picked[];
  priority: TicketPriority;
  subject: string;
  description: string;
  deadline: string;
  project: string;
  files: File[];
}) {
  const many = to.length > 1;

  return (
    <Modal
      open
      onClose={pending ? () => {} : onClose}
      title="Review this request"
      description={
        many
          ? `${to.length} departments are being asked, and each gets its own ticket.`
          : "This is what the department will see."
      }
      className="max-w-lg"
    >
      <div className="rounded-field bg-ink-50 px-3.5 py-3">
        <p className="text-sm font-bold text-ink-900">{subject}</p>
        <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink-600">{description}</p>
      </div>

      <dl className="mt-3 divide-y divide-line text-[13px]">
        {from.length > 0 && <ReviewRow label="From">{from.join(", ")}</ReviewRow>}

        <ReviewRow label={many ? "To" : "To department"}>
          <span className="flex flex-wrap justify-end gap-1">
            {to.map((name) => (
              <span
                key={name}
                className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700"
              >
                {name}
              </span>
            ))}
          </span>
        </ReviewRow>

        <ReviewRow label="Addressed to">
          {people.length === 0 ? (
            <span className="font-normal text-ink-400">Nobody yet · the head assigns it</span>
          ) : (
            people.map((person) => person.name).join(", ")
          )}
        </ReviewRow>

        <ReviewRow label="Priority">
          <PriorityBadge priority={priority} />
        </ReviewRow>

        <ReviewRow label="Deadline">{formatDate(deadline)}</ReviewRow>

        {project && <ReviewRow label="Related project">{project}</ReviewRow>}

        {files.length > 0 && (
          <ReviewRow label="Attachments">
            <span className="flex flex-col items-end gap-0.5">
              {files.map((file, index) => (
                <span key={file.name + index} className="truncate">
                  {file.name}
                  <span className="ml-1.5 font-normal text-ink-400">{formatBytes(file.size)}</span>
                </span>
              ))}
            </span>
          </ReviewRow>
        )}
      </dl>

      {many && (
        <p className="mt-3 rounded-md bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
          {to.length} separate tickets are raised, one per department. Each has its own number and
          is resolved on its own.
        </p>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
          Back to the form
        </Button>
        <Button type="button" size="sm" onClick={onRaise} disabled={pending}>
          {/* At 100% the bytes are sent and only the answer is left, which
              is the ticket being raised - so it says that instead. */}
          {uploading !== null && uploading < 100
            ? `Uploading ${uploading}%`
            : pending
              ? "Raising..."
              : many
                ? `Raise ${to.length} tickets`
                : "Raise ticket"}
        </Button>
      </div>
    </Modal>
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
      className="max-w-sm"
    >
      {tickets && tickets.length > 0 && (
        <>
          {/* The numbers and the subject: proof it exists, and which one it
              was. Everything else about it is on the list behind. */}
          <div className="flex items-start gap-2 rounded-field bg-status-completed-bg px-3 py-2">
            <CheckCircle2 className="mt-px size-4 shrink-0 text-status-completed-fg" />
            <div className="min-w-0">
              <p className="text-[13px] leading-snug font-semibold text-status-completed-fg">
                {tickets.map((ticket) => ticket.number).join(", ")} created
              </p>
              <p className="truncate text-[12px] text-ink-600">{tickets[0].subject}</p>
            </div>
          </div>

          <dl className="mt-3 divide-y divide-line text-[12px]">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="flex justify-between gap-4 py-1.5">
                <dt className="text-ink-500">{ticket.number}</dt>
                <dd className="font-semibold text-ink-900">{ticket.department.name}</dd>
              </div>
            ))}
            {tickets[0].fromDepartments.length > 0 && (
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-ink-500">On behalf of</dt>
                <dd className="text-right font-semibold text-ink-900">
                  {tickets[0].fromDepartments.map((item) => item.name).join(", ")}
                </dd>
              </div>
            )}
            {tickets[0].assignees.length > 0 && (
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-ink-500">Addressed to</dt>
                <dd className="text-right font-semibold text-ink-900">
                  {tickets[0].assignees.map((person) => person.name).join(", ")}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="text-ink-500">Priority</dt>
              <dd className="font-semibold text-ink-900">{tickets[0].priority}</dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Raise another
            </Button>
            {/* Matches Button's `sm`, so the pair reads as one row of controls. */}
            <Link
              href="/my-requests"
              className="inline-flex h-7 items-center justify-center rounded-md bg-brand-600 px-2.5 text-[12px] font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700"
            >
              View my requests
            </Link>
          </div>
        </>
      )}
    </Modal>
  );
}
