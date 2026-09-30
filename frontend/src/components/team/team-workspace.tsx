"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Building2, Eye, EyeOff, Search, UserPlus } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PhoneInput } from "@/components/ui/phone-input";
import { MemberSheet } from "@/components/team/member-sheet";
import { WorkEmailInput } from "@/components/ui/work-email-input";
import { formatPhone, isPhone, PHONE_HELP, toStoredPhone } from "@/lib/phone";
import { Modal } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { ScopeFilter, type ScopeOption, type ScopeValue } from "@/components/ui/scope-filter";
import { FilteredStrip, type ActiveFilter } from "@/components/ui/filtered-strip";
import { RoleTag } from "@/components/ui/badge";
import { StatTiles } from "@/components/ui/stat-tiles";
import { TableCell, TableHead } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth/auth-provider";
import { addMember } from "@/lib/departments";
import { listMyTeam, type DirectoryUser } from "@/lib/users";
import { avatarTone, headDepartments, initials, type DepartmentRole } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Stat } from "@/lib/types";

const STATUS_CHIP: Record<DirectoryUser["status"], string> = {
  active: "bg-status-completed-bg text-status-completed-fg",
  invited: "bg-status-waiting-bg text-status-waiting-fg",
  suspended: "bg-status-overdue-bg text-status-overdue-fg",
};

/** The shortest password the API accepts, said before it is hit. */
const MIN_PASSWORD = 8;

/** An empty cell, said quietly. */
function Dash() {
  return <span className="text-ink-300">—</span>;
}

function Banner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

/**
 * Everyone this person runs, and only them.
 *
 * A head is not an admin: the page shows the departments they are head of and
 * nothing beyond, which is also exactly what the API will answer. The filters
 * narrow within that - useful the moment somebody runs two departments - and
 * cannot widen it.
 */
export function TeamWorkspace() {
  const { session } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  /** Unit and department are the same axis at two depths, so they are one. */
  const [where, setWhere] = useState<ScopeValue>({ units: [], departments: [] });
  // A tile elsewhere can link straight to a role: `?role=head` or `?role=team`.
  const params = useSearchParams();
  const [roles, setRoles] = useState<string[]>(() => {
    const named = params.get("role");
    return named === "head" || named === "team" ? [named] : [];
  });
  const [statuses, setStatuses] = useState<string[]>([]);
  /** Set by the one tile that is not a role or a status. */
  const [view, setView] = useState<"incomplete" | null>(null);
  const [adding, setAdding] = useState(false);
  /** The member in the sheet. Kept after it closes, so it slides out full. */
  const [viewing, setViewing] = useState<DirectoryUser | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = (user: DirectoryUser) => {
    setViewing(user);
    setSheetOpen(true);
  };
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  /** The scope, taken from the session: the departments they are head of. */
  const mine = useMemo(() => headDepartments(session), [session]);
  const mineIds = useMemo(() => new Set(mine.map((item) => item.id)), [mine]);



  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await listMyTeam({}, signal);
      setUsers(data.users);
      setError("");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Fetching is the "subscribe to an external system" case the rule allows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** What somebody is on *this* team, which is not always what they are elsewhere. */
  const roleHere = useCallback(
    (user: DirectoryUser): DepartmentRole =>
      user.departments.some((item) => mineIds.has(item.id) && item.role === "head")
        ? "head"
        : "team",
    [mineIds],
  );

  /** Only the memberships this head is entitled to care about. */
  const here = useCallback(
    (user: DirectoryUser) => user.departments.filter((item) => mineIds.has(item.id)),
    [mineIds],
  );

  /** No phone, or no designation on one of their roles in this head's departments. */
  const incomplete = useCallback(
    (user: DirectoryUser) =>
      !user.phone || here(user).some((item) => !item.designation?.trim()),
    [here],
  );

  const scopeOptions = useMemo<ScopeOption[]>(
    () =>
      mine.map((membership) => ({
        id: membership.id,
        name: membership.name ?? "Department",
        unit: membership.unit
          ? { id: membership.unit.id, name: membership.unit.name ?? "Unit" }
          : null,
        count: users.filter((user) => user.departments.some((item) => item.id === membership.id))
          .length,
      })),
    [mine, users],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();

    return users.filter((user) => {
      if (
        term &&
        !`${user.name} ${user.email} ${user.phone ?? ""} ${here(user)
          .map((item) => item.designation ?? "")
          .join(" ")}`
          .toLowerCase()
          .includes(term)
      )
        return false;
      if (statuses.length > 0 && !statuses.includes(user.status)) return false;
      if (roles.length > 0 && !roles.includes(roleHere(user))) return false;
      if (view === "incomplete" && !incomplete(user)) return false;

      // A ticked unit means everything under it, so either half of the
      // answer is enough for a row to stay.
      const narrowed = where.units.length > 0 || where.departments.length > 0;
      if (narrowed) {
        const theirs = here(user);
        const kept = theirs.some(
          (item) =>
            where.departments.includes(item.id) ||
            (item.unit ? where.units.includes(item.unit.id) : false),
        );
        if (!kept) return false;
      }
      return true;
    });
  }, [users, query, statuses, roles, where, roleHere, here, view, incomplete]);

  const stats: Stat[] = useMemo(
    () => [
      {
        label: "Team Members",
        value: users.length,
        caption: mine.length === 1 ? (mine[0].name ?? "Your department") : `${mine.length} departments`,
        tone: "new",
        key: "all",
      },
      {
        label: "Heads",
        value: users.filter((user) => roleHere(user) === "head").length,
        caption: "Running a department",
        tone: "admin",
        key: "head",
      },
      {
        label: "Users",
        value: users.filter((user) => roleHere(user) === "team").length,
        caption: "In your team",
        tone: "progress",
        key: "team",
      },
      {
        label: "Active",
        value: users.filter((user) => user.status === "active").length,
        caption: "Signed in and working",
        tone: "completed",
        key: "active",
      },
      {
        label: "Suspended",
        value: users.filter((user) => user.status === "suspended").length,
        caption: "Access revoked",
        tone: "overdue",
        key: "suspended",
      },
      {
        label: "Missing Details",
        value: users.filter(incomplete).length,
        caption: "No phone or designation",
        tone: "waiting",
        key: "incomplete",
      },
    ],
    [users, mine, roleHere, incomplete],
  );

  /*
   * A tile is one lens on the list: picking it replaces whatever the other
   * tiles had set, and the dropdowns follow so they always show the truth.
   * Clicking the lit tile, or the total, shows everybody again.
   */
  const litTile =
    view !== null
      ? view
      : roles.length === 1 && statuses.length === 0
        ? roles[0]
        : statuses.length === 1 && roles.length === 0
          ? statuses[0]
          : roles.length === 0 && statuses.length === 0
            ? "all"
            : null;

  const selectTile = (key: string) => {
    const again = key === litTile;
    setView(!again && key === "incomplete" ? "incomplete" : null);
    setRoles(!again && (key === "head" || key === "team") ? [key] : []);
    setStatuses(!again && (key === "active" || key === "suspended") ? [key] : []);
  };

  /** What is narrowing the list, each one removable on its own. */
  const filters: ActiveFilter[] = [];
  if (view === "incomplete") {
    filters.push({ key: "view", label: "Missing details", clear: () => setView(null) });
  }
  if (roles.length > 0) {
    filters.push({
      key: "roles",
      label: `Role: ${roles.map((role) => (role === "head" ? "Head" : "User")).join(", ")}`,
      clear: () => setRoles([]),
    });
  }
  if (statuses.length > 0) {
    filters.push({
      key: "statuses",
      label: `Status: ${statuses.map((status) => status[0].toUpperCase() + status.slice(1)).join(", ")}`,
      clear: () => setStatuses([]),
    });
  }
  if (where.units.length + where.departments.length > 0) {
    filters.push({
      key: "where",
      label: `In: ${where.units.length + where.departments.length} selected`,
      clear: () => setWhere({ units: [], departments: [] }),
    });
  }
  if (query.trim()) {
    filters.push({ key: "query", label: `“${query.trim()}”`, clear: () => setQuery("") });
  }

  const clearFilters = () => {
    setView(null);
    setRoles([]);
    setStatuses([]);
    setWhere({ units: [], departments: [] });
    setQuery("");
  };

  return (
    <>
      {error && <Banner message={error} />}

      {/* Team Members clears both filters; Heads narrows by role, the other
          two by status. Clicking the lit tile lets go of it. */}
      <StatTiles
        stats={stats}
        loading={loading}
        active={litTile}
        onSelect={selectTile}
      />

      <Card className="mt-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-1.5">
          <div className="min-w-44 flex-1">
            <Input
              className="h-8 text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by name or email"
              aria-label="Search your team"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {/* Only worth offering to somebody who runs more than one; otherwise
              it is a filter with a single answer. */}
          {mine.length > 1 && (
            <div className="w-52 shrink-0">
              <ScopeFilter
                id="team-where"
                options={scopeOptions}
                value={where}
                onChange={setWhere}
              />
            </div>
          )}

          <MultiSelect
            className="h-8 w-32 text-[13px]"
            ariaLabel="Filter by role"
            display="summary"
            options={[
              { value: "head", label: "Head" },
              { value: "team", label: "User" },
            ]}
            value={roles}
            onChange={setRoles}
            placeholder="All roles"
          />

          <MultiSelect
            className="h-8 w-32 text-[13px]"
            ariaLabel="Filter by status"
            display="summary"
            options={[
              { value: "active", label: "Active" },
              { value: "invited", label: "Invited" },
              { value: "suspended", label: "Suspended" },
            ]}
            value={statuses}
            onChange={setStatuses}
            placeholder="All statuses"
          />

          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            Add User
          </Button>
        </div>

        {/* A narrowed list says so, and puts each filter one click from gone. */}
        <FilteredStrip
          filters={filters}
          shown={rows.length}
          total={users.length}
          noun="members"
          onClearAll={clearFilters}
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-225 border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>Member</TableHead>
                <TableHead sortable>Designation</TableHead>
                <TableHead sortable>Department</TableHead>
                <TableHead sortable>Unit</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead sortable>Role</TableHead>
                <TableHead sortable>Status</TableHead>
              </tr>
            </thead>

            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center">
                    <UserPlus className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">
                      {users.length === 0 ? "Nobody here yet" : "Nobody matches that"}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {users.length === 0
                        ? "Add someone and they can raise and pick up tickets straight away."
                        : "Clear a filter to see the rest of your team."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((user) => {
                  const theirs = here(user);
                  const role = roleHere(user);
                  // Their titles in the departments you run - a person can be
                  // something else elsewhere, and that is not this page's
                  // business. The sheet has the whole of them.
                  const titles = theirs.map((item) => item.designation).filter(Boolean);
                  const unitNames = [
                    ...new Set(theirs.map((item) => item.unit?.name).filter(Boolean)),
                  ];
                  const phone = formatPhone(user.phone);
                  const selected = sheetOpen && viewing?.id === user.id;

                  return (
                    <tr
                      key={user.id}
                      tabIndex={0}
                      aria-selected={selected}
                      onClick={() => openSheet(user)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSheet(user);
                        }
                      }}
                      className={cn(
                        "cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-ink-50/70 focus-visible:bg-ink-50/70 focus-visible:outline-none",
                        selected && "bg-brand-50/50 hover:bg-brand-50/50",
                      )}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <Avatar
                            initials={initials(user.name)}
                            tone={avatarTone(user)}
                            className="size-8 text-[11px]"
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                              <span className="truncate">{user.name}</span>
                              {user.id === session?.id && (
                                <span className="shrink-0 rounded bg-ink-100 px-1 py-px text-[9px] font-bold tracking-wide text-ink-600 uppercase">
                                  You
                                </span>
                              )}
                            </span>
                            <span className="block max-w-56 truncate text-[11px] text-ink-500">
                              {user.email}
                            </span>
                          </span>
                        </span>
                      </TableCell>

                      <TableCell className="text-[12px] font-medium text-ink-700">
                        {titles.length > 0 ? titles.join(" · ") : <Dash />}
                      </TableCell>

                      <TableCell className="whitespace-normal">
                        <span className="flex flex-wrap gap-1">
                          {theirs.map((item) => (
                            <span
                              key={item.id}
                              className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600"
                            >
                              {item.name ?? "Department"}
                            </span>
                          ))}
                        </span>
                      </TableCell>

                      <TableCell className="text-[12px] text-ink-600">
                        {unitNames.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="size-3.5 shrink-0 text-ink-400" />
                            {unitNames.join(", ")}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </TableCell>

                      <TableCell className="text-[12px] text-ink-600 tabular-nums">
                        {phone || <Dash />}
                      </TableCell>

                      <TableCell>
                        <RoleTag role={role} />
                      </TableCell>

                      <TableCell>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize",
                            STATUS_CHIP[user.status],
                          )}
                        >
                          {user.status}
                        </span>
                      </TableCell>
                    </tr>
                  );
                })}

              {loading && <TableSkeleton rows={5} columns={7} />}
            </tbody>
          </table>
        </div>
      </Card>

      <MemberSheet
        user={viewing}
        open={sheetOpen}
        isSelf={viewing?.id === session?.id}
        onClose={closeSheet}
      />

      {adding && (
        <AddUserModal
          departments={mine.map((item) => ({
            id: item.id,
            name: item.name ?? "Department",
            unit: item.unit?.name,
          }))}
          onClose={() => setAdding(false)}
          onAdded={(name, where) => {
            setAdding(false);
            toast.success(`${name} added to ${where}`, "They can sign in with that password.");
            void load();
          }}
        />
      )}
    </>
  );
}

/**
 * Makes an account and puts it straight into one of this head's departments.
 *
 * The department is a choice between theirs and nothing else, because that is
 * the only thing the API will accept from them - there is no way to spend this
 * form on somebody else's team.
 */
function AddUserModal({
  departments,
  onClose,
  onAdded,
}: {
  departments: { id: string; name: string; unit?: string }[];
  onClose: () => void;
  onAdded: (name: string, department: string) => void;
}) {
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [role, setRole] = useState<DepartmentRole>("team");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) return setError("Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Enter a valid email address.");
    }
    if (!isPhone(phone)) return setError(PHONE_HELP);
    if (designation.trim().length < 2) return setError("Designation is required.");
    if (password.length < MIN_PASSWORD) {
      return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    }

    setPending(true);
    try {
      const member = await addMember(departmentId, {
        name: name.trim(),
        email: email.trim(),
        phone: toStoredPhone(phone),
        designation: designation.trim(),
        password,
        role,
      });
      onAdded(
        member.name,
        departments.find((item) => item.id === departmentId)?.name ?? "your department",
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={pending ? () => {} : onClose}
      title="Add a user"
      description="They can sign in straight away and start raising and picking up tickets."
      className="max-w-md"
    >
      <form className="space-y-3.5" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Full name" required htmlFor="team-name">
            <Input
              id="team-name"
              className="h-9"
              placeholder="e.g. Rida Nawaz"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label="Work email" required htmlFor="team-email">
            <WorkEmailInput
              id="team-email"
              className="h-9"
              placeholder="name"
              value={email}
              onChange={setEmail}
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Phone number" required htmlFor="team-phone">
            <PhoneInput
              id="team-phone"
              className="h-9"
              placeholder="+971 50 123 4567"
              value={phone}
              onChange={setPhone}
            />
          </Field>

          <Field
            label="Designation"
            required
            hint="(in this department)"
            htmlFor="team-designation"
          >
            <Input
              id="team-designation"
              className="h-9"
              placeholder="e.g. HR Executive"
              maxLength={80}
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          {/* Only the departments this person runs: the API refuses any other,
              so offering one would be offering a failure. With a single one
              there is no choice to make, and a dropdown that cannot open reads
              as a broken dropdown - so it is shown as the fact it is. */}
          <Field label="Department" required htmlFor="team-department">
            {departments.length === 1 ? (
              <p
                id="team-department"
                className="flex h-9 items-center gap-1.5 rounded-field border border-line bg-ink-50 px-3 text-sm font-medium text-ink-600"
              >
                <Building2 className="size-4 shrink-0 text-ink-400" />
                <span className="truncate">
                  {departments[0].name}
                  {departments[0].unit && (
                    <span className="ml-1 text-ink-400">· {departments[0].unit}</span>
                  )}
                </span>
              </p>
            ) : (
              <Select
                id="team-department"
                className="h-9"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                {departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.unit ? `${item.name} · ${item.unit}` : item.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Role in the department" required htmlFor="team-role">
            <Select
              id="team-role"
              className="h-9"
              value={role}
              onChange={(event) => setRole(event.target.value as DepartmentRole)}
            >
              <option value="team">User</option>
              <option value="head">Head</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Temporary password"
          required
          hint={`(at least ${MIN_PASSWORD} characters)`}
          htmlFor="team-password"
        >
          <Input
            id="team-password"
            className="h-9"
            type={shown ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            trailing={
              <button
                type="button"
                onClick={() => setShown((current) => !current)}
                className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                aria-label={shown ? "Hide password" : "Show password"}
              >
                {shown ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
              </button>
            }
          />
        </Field>

        <p className="rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
          Hand them the password yourself; they can change it under Settings. A head can add and
          run people here — changing somebody&apos;s role afterwards stays with an admin.
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
