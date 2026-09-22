"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Search,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RoleTag } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { TableCell, TableHead } from "@/components/ui/table";
import { StatTiles } from "@/components/ui/stat-tiles";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { initials, isAdmin, type DepartmentRole } from "@/lib/auth";
import type { Stat } from "@/lib/types";
import { DepartmentRolePicker } from "@/components/departments/department-role-picker";
import {
  addMember,
  getDepartment,
  listDepartments,
  removeMember,
  updateMemberRole,
  type Department,
  type Member,
} from "@/lib/departments";
import { updateUser, type MembershipInput } from "@/lib/users";
import { cn, formatDate } from "@/lib/utils";

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

export function DepartmentDetail({ departmentId }: { departmentId: string }) {
  const { session } = useAuth();
  const toast = useToast();

  /** An admin runs every department; a head runs the one it leads. */
  const myRole = session?.departments.find((item) => item.id === departmentId)?.role;
  const isHere = isAdmin(session);
  const isHead = myRole === "head";
  const canManage = isHere || isHead;

  const [department, setDepartment] = useState<Department | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await getDepartment(departmentId, signal);
        setDepartment(data.department);
        setMembers(data.members);
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        // An aborted request is not an answer. React mounts an effect twice in
        // development, so the first fetch is always cancelled: clearing the flag
        // here would declare "nothing found" while the real request is still out.
        if (!signal?.aborted) setLoading(false);
      }
    },
    [departmentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const changeRole = async (member: Member, role: DepartmentRole) => {
    const previous = members;
    setMembers((current) =>
      current.map((item) => (item.id === member.id ? { ...item, departmentRole: role } : item)),
    );
    try {
      await updateMemberRole(departmentId, member.id, role);
      await load();
      toast.success(`${member.name} is now ${role === "head" ? "a head" : "a team member"}`);
    } catch (caught) {
      setMembers(previous);
      toast.error(`Could not change the role of ${member.name}`, errorMessage(caught));
    }
  };

  const remove = async (member: Member) => {
    const previous = members;
    setMembers((current) => current.filter((item) => item.id !== member.id));
    try {
      await removeMember(departmentId, member.id);
      await load();
      toast.success(`${member.name} removed`, `No longer in ${department?.name ?? "this department"}.`);
    } catch (caught) {
      setMembers(previous);
      toast.error(`Could not remove ${member.name}`, errorMessage(caught));
    }
  };

  const visible = members.filter((member) =>
    (member.name + member.email).toLowerCase().includes(query.trim().toLowerCase()),
  );

  const header = (name: string) => (
    <PageHeader
      title={name}
      backHref="/departments"
      /* The trail shows where this sits in the chart: unit, then department.
         Units are an admin page, so for everyone else the unit is named but
         not linked - a dead link is worse than plain text. */
      crumbs={[
        { label: "Home", href: "/dashboard" },
        ...(isHere ? [{ label: "Units", href: "/units" as const }] : []),
        ...(department?.unit
          ? [
              {
                label: department.unit.name ?? "Unit",
                ...(isHere ? { href: `/units/${department.unit.id}` as const } : {}),
              },
            ]
          : []),
        { label: name },
      ]}
    />
  );

  if (loading) {
    return (
      <>
        {header("Department")}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-4 w-44" />
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <TableSkeleton rows={4} columns={4} />
            </tbody>
          </table>
        </Card>
      </>
    );
  }

  if (!department) {
    return (
      <>
        {header("Department")}
        <Banner message={error || "Department not found."} />
      </>
    );
  }

  return (
    <>
      {header(department.name)}

      {error && <Banner message={error} />}

      <StatTiles
        stats={
          [
            { label: "Members", value: department.memberCount, caption: "", tone: "progress" },
            { label: "Heads", value: department.headCount, caption: "", tone: "admin" },
            { label: "Team", value: department.teamCount, caption: "", tone: "completed" },
          ] satisfies Stat[]
        }
        className="mb-2"
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-1.5">
          <div className="min-w-48 flex-1">
            <Input
              className="h-7 text-[12px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search members..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search members"
            />
          </div>
          {canManage && (
            <Button size="sm" className="h-7 shrink-0" onClick={() => setAddOpen(true)}>
              <UserPlus className="size-3.5" />
              Add User
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>Member</TableHead>
                <TableHead sortable>Role</TableHead>
                <TableHead sortable>Status</TableHead>
                <TableHead sortable>Joined</TableHead>
                {canManage && <TableHead>Actions</TableHead>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="px-3 py-10 text-center">
                    <UserRound className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">No members yet</p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {canManage
                        ? "Add a head to own this department, then its team."
                        : "Nobody has been added to this department."}
                    </p>
                  </td>
                </tr>
              )}

              {visible.map((member) => (
                <tr key={member.id} className="border-b border-line last:border-0 hover:bg-ink-50/70">
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <Avatar
                        initials={initials(member.name)}
                        tone={member.departmentRole}
                        className="size-8 text-[11px]"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink-900">{member.name}</span>
                        <span className="block text-xs text-ink-400">{member.email}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <RoleTag role={member.departmentRole} />
                  </TableCell>
                  <TableCell className="capitalize">{member.status}</TableCell>
                  <TableCell>{formatDate(member.createdAt.slice(0, 10))}</TableCell>
                  {canManage && (
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {isHere ? (
                          <Select
                            className="h-7 w-[5.5rem] pr-6 pl-2 text-[11px]"
                            value={member.departmentRole}
                            onChange={(event) =>
                              changeRole(member, event.target.value as DepartmentRole)
                            }
                            aria-label={`Role for ${member.name}`}
                          >
                            <option value="head">Head</option>
                            <option value="team">Team</option>
                          </Select>
                        ) : (
                          <RoleTag role={member.departmentRole} />
                        )}

                        {(isHere || member.departmentRole === "team") && (
                          <button
                            type="button"
                            onClick={() => remove(member)}
                            className="grid size-7 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-600"
                            aria-label={`Remove ${member.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </span>
                    </TableCell>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <AddMemberModal
        open={addOpen}
        departmentId={departmentId}
        departmentName={department.name}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          load();
        }}
      />
    </>
  );
}

function AddMemberModal({
  open,
  departmentId,
  departmentName,
  onClose,
  onAdded,
}: {
  open: boolean;
  departmentId: string;
  departmentName: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<DepartmentRole>("team");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const toast = useToast();

  // "Advanced" puts the same person in more than one department in one go.
  const [advanced, setAdvanced] = useState(false);
  const [extras, setExtras] = useState<MembershipInput[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    if (!open || departments.length > 0) return;
    const controller = new AbortController();
    listDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, [open, departments.length]);

  const close = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("team");
    setShowPassword(false);
    setAdvanced(false);
    setExtras([]);
    setError("");
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (password && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setPending(true);
    try {
      const member = await addMember(departmentId, {
        name: name.trim() || undefined,
        email: email.trim(),
        password: password || undefined,
        role,
      });

      if (extras.length > 0) {
        // Merge rather than replace: whatever the account already belonged to
        // stays, and the picked roles win where both name the same department.
        const merged = new Map<string, MembershipInput>(
          member.departments.map((item) => [item.id, { department: item.id, role: item.role }]),
        );
        extras.forEach((entry) => merged.set(entry.department, entry));
        await updateUser(member.id, { memberships: [...merged.values()] });
      }

      toast.success(
        `${member.name} added to ${departmentName}`,
        `Role: ${role === "head" ? "Head" : "Team"}${
          extras.length > 0 ? ` · also in ${extras.length} other department(s)` : ""
        }`,
      );
      close();
      onAdded();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add User"
      description={`Create an account in ${departmentName}, or attach an existing one.`}
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        <Field label="Email" required htmlFor="member-email">
          <Input
            id="member-email"
            type="email"
            className="h-8"
            icon={<Mail className="text-ink-500" />}
            placeholder="name@flowdesk.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
            name="member-email"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="member-name">
            <Input
              id="member-name"
              className="h-8"
              icon={<UserRound className="text-ink-500" />}
              placeholder="New accounts only"
              value={name}
              onChange={(event) => setName(event.target.value)}
              name="member-name"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
            />
          </Field>

          <Field label="Role" required htmlFor="member-role">
            <Select
              id="member-role"
              className="h-8"
              value={role}
              onChange={(event) => setRole(event.target.value as DepartmentRole)}
            >
              <option value="head">Head</option>
              <option value="team">Team</option>
            </Select>
          </Field>
        </div>

        <Field label="Temporary password" htmlFor="member-password">
          <Input
            id="member-password"
            type={showPassword ? "text" : "password"}
            className="h-8"
            icon={<Lock className="text-ink-500" />}
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            name="member-password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
              </button>
            }
          />
        </Field>

        <p className="text-xs text-ink-400">
          Name and password are only used when the email is new. An email that already has an
          account is simply added to this department.
        </p>

        <div className="rounded-field border border-line">
          <button
            type="button"
            onClick={() => setAdvanced((current) => !current)}
            aria-expanded={advanced}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span className="text-sm font-semibold text-ink-800">
              Advanced
              <span className="ml-1.5 font-normal text-ink-400">
                add to other departments{extras.length > 0 ? ` (${extras.length})` : ""}
              </span>
            </span>
            <ChevronDown
              className={cn("size-4 text-ink-400 transition-transform", advanced && "rotate-180")}
            />
          </button>

          {advanced && (
            <div className="border-t border-line p-3">
              <DepartmentRolePicker
                departments={departments}
                lockedDepartmentId={departmentId}
                value={[{ department: departmentId, role }, ...extras]}
                onChange={(next) =>
                  setExtras(next.filter((item) => item.department !== departmentId))
                }
              />
              <p className="mt-2 text-xs text-ink-400">
                The current department uses the role picked above.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add User"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
