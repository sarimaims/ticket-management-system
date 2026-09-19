"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  ShieldPlus,
  UserCheck,
  UserMinus,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RoleTag } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Pagination, TableCell, TableHead } from "@/components/ui/table";
import { StatTiles } from "@/components/ui/stat-tiles";
import { DepartmentRolePicker } from "@/components/departments/department-role-picker";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { avatarTone, initials, isSuperAdmin, ROLE_LABEL } from "@/lib/auth";
import { listDepartments, type Department } from "@/lib/departments";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  type DirectoryUser,
  type MembershipInput,
} from "@/lib/users";
import { cn, formatDate } from "@/lib/utils";
import type { Stat } from "@/lib/types";

/** Which slice of the directory a page shows. */
export type Scope = "admins" | "all";

const STATUS_CHIP: Record<DirectoryUser["status"], string> = {
  active: "bg-status-completed-bg text-status-completed-fg",
  invited: "bg-status-waiting-bg text-status-waiting-fg",
  suspended: "bg-status-overdue-bg text-status-overdue-fg",
};

const ACTION_BTN =
  "grid size-7 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700";

/** Mongo ids are long; the tail is enough to tell two rows apart. */
function shortId(id: string) {
  return id.slice(-6).toUpperCase();
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

function statsFor(users: DirectoryUser[], scope: Scope): Stat[] {
  const count = (predicate: (user: DirectoryUser) => boolean) => users.filter(predicate).length;

  return [
    {
      label: scope === "admins" ? "Total Admins" : "Total Users",
      value: users.length,
      caption: "In this directory",
      tone: "new",
    },
    {
      label: "Active",
      value: count((user) => user.status === "active"),
      caption: "Signed in and working",
      tone: "completed",
    },
    {
      label: "Suspended",
      value: count((user) => user.status === "suspended"),
      caption: "Access revoked",
      tone: "overdue",
    },
    {
      label: "Super Admins",
      value: count((user) => user.role === "superadmin"),
      caption: "Full access",
      tone: "admin",
    },
  ];
}

/** A system role wins; otherwise the strongest department role they hold. */
function effectiveRole(user: DirectoryUser) {
  if (user.role === "superadmin") return "superadmin" as const;
  if (user.role === "admin") return "admin" as const;
  return user.departments.some((item) => item.role === "head") ? ("head" as const) : ("team" as const);
}

export function PeopleWorkspace({ scope }: { scope: Scope }) {
  const { session } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");

  const [editing, setEditing] = useState<DirectoryUser | null>(null);
  const [removing, setRemoving] = useState<DirectoryUser | null>(null);
  const [creating, setCreating] = useState(false);

  const scopeRole = scope === "admins" ? "admin" : "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setUsers(await listUsers({ role: scopeRole || undefined }, signal));
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [scopeRole],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    listDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, [load]);

  const stats = useMemo(() => statsFor(users, scope), [users, scope]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return users.filter((user) => {
      if (term && !`${user.name} ${user.email} ${shortId(user.id)}`.toLowerCase().includes(term))
        return false;
      if (department && !user.departments.some((item) => item.id === department)) return false;
      if (status && user.status !== status) return false;
      if (role && effectiveRole(user) !== role) return false;
      return true;
    });
  }, [users, query, department, status, role]);

  const setStatusFor = async (user: DirectoryUser, next: DirectoryUser["status"]) => {
    try {
      const updated = await updateUser(user.id, { status: next });
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setError("");
      toast.success(`${updated.name} is now ${next}`);
    } catch (caught) {
      toast.error(`Could not update ${user.name}`, errorMessage(caught));
    }
  };

  return (
    <>
      {error && <Banner message={error} />}

      <StatTiles stats={stats} />

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-3 py-2.5">
          <div className="w-full lg:min-w-44 lg:flex-1">
            <Input
              className="h-11 text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by name, email or user ID..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search people"
            />
          </div>

          <Select
            className="h-11 min-w-[116px] flex-1 pr-8 pl-3 text-[13px] lg:w-40 lg:flex-none"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            aria-label="Filter by department"
          >
            <option value="">All Departments</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>

          {scope === "all" && (
            <Select
              className="h-11 min-w-[116px] flex-1 pr-8 pl-3 text-[13px] lg:w-36 lg:flex-none"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All Roles</option>
              <option value="superadmin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="head">Head</option>
              <option value="team">Team</option>
            </Select>
          )}

          <Select
            className="h-11 min-w-[116px] flex-1 pr-8 pl-3 text-[13px] lg:w-32 lg:flex-none"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="suspended">Suspended</option>
          </Select>

          {scope === "admins" && (
            <Button className="h-11" onClick={() => setCreating(true)}>
              <ShieldPlus className="size-4.5" />
              Create Admin
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>User ID</TableHead>
                <TableHead sortable className="min-w-[200px]">
                  Name
                </TableHead>
                <TableHead sortable>Departments</TableHead>
                <TableHead sortable>Role</TableHead>
                <TableHead sortable>Status</TableHead>
                <TableHead sortable>Joined</TableHead>
                <TableHead sortable>Last Active</TableHead>
                <TableHead>Actions</TableHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => {
                const shown = effectiveRole(user);
                return (
                  <tr
                    key={user.id}
                    className="border-b border-line transition-colors last:border-0 hover:bg-ink-50/70"
                  >
                    <TableCell>
                      <span className="text-sm font-semibold text-brand-600">
                        #{shortId(user.id)}
                      </span>
                    </TableCell>

                    <TableCell className="whitespace-normal">
                      <span className="flex items-center gap-2.5">
                        <Avatar
                            initials={initials(user.name)}
                            tone={avatarTone(user)}
                            className="size-8 text-[11px]"
                          />
                        <span className="min-w-0">
                          <span className="block font-semibold text-ink-900">{user.name}</span>
                          <span className="block truncate text-xs text-ink-400">{user.email}</span>
                        </span>
                      </span>
                    </TableCell>

                    <TableCell className="whitespace-normal">
                      {user.departments.length === 0 ? (
                        <span className="text-ink-400">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {user.departments.map((item) => (
                            <span
                              key={item.id}
                              className="inline-flex items-center gap-1 rounded-md bg-ink-100 py-0.5 pr-1 pl-2 text-[11px] font-medium text-ink-600"
                            >
                              {item.name ?? "Department"}
                              <RoleTag role={item.role} className="px-1 py-0 text-[10px]" />
                            </span>
                          ))}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      {shown === "superadmin" || shown === "admin" ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold",
                            shown === "superadmin"
                              ? "bg-brand-50 text-brand-700"
                              : "bg-tile-admin-bg text-tile-admin-fg",
                          )}
                        >
                          <ShieldCheck className="size-3" />
                          {ROLE_LABEL[shown]}
                        </span>
                      ) : (
                        <RoleTag role={shown} />
                      )}
                    </TableCell>

                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2.5 py-1 text-xs font-semibold capitalize",
                          STATUS_CHIP[user.status],
                        )}
                      >
                        {user.status}
                      </span>
                    </TableCell>

                    <TableCell>{formatDate(user.createdAt.slice(0, 10))}</TableCell>
                    <TableCell>{formatDate(user.lastActiveAt.slice(0, 10))}</TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(user)}
                          className={ACTION_BTN}
                          aria-label={"Edit " + user.name}
                        >
                          <Pencil className="size-4" />
                        </button>

                        <RowMenu
                          user={user}
                          isSelf={user.id === session?.id}
                          onEdit={() => setEditing(user)}
                          onToggleStatus={() =>
                            setStatusFor(user, user.status === "suspended" ? "active" : "suspended")
                          }
                          onDelete={() => setRemoving(user)}
                        />
                      </div>
                    </TableCell>
                  </tr>
                );
              })}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-14 text-center text-sm text-ink-500">
                    No users match these filters.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-14 text-center text-sm text-ink-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          summary={`Showing 1 to ${rows.length} of ${rows.length} users`}
          pages={1}
          current={1}
        />
      </Card>

      <EditUserModal
        user={editing}
        departments={departments}
        isSelf={editing?.id === session?.id}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
          setEditing(null);
          load();
          toast.success(`${updated.name} updated`);
        }}
      />

      <CreateAdminModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          load();
        }}
      />

      <DeleteUserModal
        user={removing}
        onClose={() => setRemoving(null)}
        onDeleted={(id) => {
          const gone = users.find((item) => item.id === id);
          setUsers((current) => current.filter((item) => item.id !== id));
          setRemoving(null);
          toast.success(`${gone?.name ?? "Account"} deleted`, gone?.email);
        }}
      />
    </>
  );
}

/* ---------------------------------------------------------- create admin */

/** Both a super admin and an admin can open this; it only ever mints admins. */
function CreateAdminModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const toast = useToast();

  const close = () => {
    setName("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setError("");
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) return setError("Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Enter a valid email address.");
    }
    if (password.length < 8) return setError("Password must be at least 8 characters.");

    setPending(true);
    try {
      const created = await createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "admin",
      });
      toast.success(`${created.name} added as an admin`, created.email);
      close();
      onCreated();
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
      title="Create Admin"
      description="An admin can manage departments, members and other admins."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        <Field label="Full name" required htmlFor="admin-name">
          <Input
            id="admin-name"
            className="h-11"
            placeholder="Their full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            name="admin-name"
            autoComplete="off"
            data-1p-ignore
            autoFocus
          />
        </Field>

        <Field label="Email" required htmlFor="admin-email">
          <Input
            id="admin-email"
            type="email"
            className="h-11"
            placeholder="name@flowdesk.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            name="admin-email"
            autoComplete="off"
            data-1p-ignore
          />
        </Field>

        <Field label="Temporary password" required htmlFor="admin-password">
          <Input
            id="admin-password"
            type={showPassword ? "text" : "password"}
            className="h-11"
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            name="admin-password"
            autoComplete="new-password"
            data-1p-ignore
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
          The super admin role is fixed and cannot be granted here.
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create Admin"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ menu */

function RowMenu({
  user,
  isSelf,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  user: DirectoryUser;
  isSelf: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={ACTION_BTN}
        aria-label={"More actions for " + user.name}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-52 rounded-field border border-line bg-surface p-1.5 shadow-xl shadow-ink-900/10"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Pencil className="size-4 text-ink-400" />
            Edit profile
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={isSelf}
            title={isSelf ? "You cannot change your own status." : undefined}
            className={item}
            onClick={() => {
              setOpen(false);
              onToggleStatus();
            }}
          >
            {user.status === "suspended" ? (
              <>
                <UserCheck className="size-4 text-ink-400" />
                Reactivate access
              </>
            ) : (
              <>
                <UserMinus className="size-4 text-ink-400" />
                Suspend access
              </>
            )}
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={isSelf || user.role === "superadmin"}
            title={
              user.role === "superadmin"
                ? "The super admin profile cannot be deleted."
                : isSelf
                  ? "You cannot delete your own account."
                  : undefined
            }
            className={cn(item, "text-brand-700 hover:bg-brand-50")}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="size-4" />
            Delete user
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ edit */

function EditUserModal({
  user,
  departments,
  isSelf,
  onClose,
  onSaved,
}: {
  user: DirectoryUser | null;
  departments: Department[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (user: DirectoryUser) => void;
}) {
  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Edit User"
      description="Profile, access and the departments this person belongs to."
    >
      {user && (
        <EditUserForm
          key={user.id}
          user={user}
          departments={departments}
          isSelf={isSelf}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

/** Keyed by user id, so opening a different row starts from that row's values. */
function EditUserForm({
  user,
  departments,
  isSelf,
  onClose,
  onSaved,
}: {
  user: DirectoryUser;
  departments: Department[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (user: DirectoryUser) => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [status, setStatus] = useState(user.status);
  const [role, setRole] = useState<"admin" | "user">(user.role === "admin" ? "admin" : "user");
  const [memberships, setMemberships] = useState<MembershipInput[]>(
    user.departments.map((item) => ({ department: item.id, role: item.role })),
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  /** The one super admin keeps its role no matter who is editing. */
  const isFixedRole = isSuperAdmin(user);
  /** Managers are workspace-wide, so they hold no department memberships. */
  const isManager = isFixedRole || role === "admin";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (password && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setPending(true);
    try {
      onSaved(
        await updateUser(user.id, {
          name: name.trim(),
          email: email.trim(),
          ...(isManager ? {} : { memberships }),
          // Left blank means "keep the current password".
          ...(password ? { password } : {}),
          // The API refuses these on your own account anyway; don't even send
          // them. The super admin's role is fixed, so it is never sent either.
          ...(isSelf ? {} : { status, ...(isFixedRole ? {} : { role }) }),
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {error && <Banner message={error} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required htmlFor="edit-name">
          <Input
            id="edit-name"
            className="h-11"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Email" required htmlFor="edit-email">
          <Input
            id="edit-email"
            type="email"
            className="h-11"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Status" htmlFor="edit-status">
          <Select
            id="edit-status"
            className="h-11"
            value={status}
            disabled={isSelf}
            onChange={(event) => setStatus(event.target.value as DirectoryUser["status"])}
          >
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="suspended">Suspended</option>
          </Select>
        </Field>

        <Field label="System role" htmlFor="edit-role">
          {isFixedRole ? (
            <div className="flex h-11 items-center rounded-field border border-line-strong bg-ink-50 px-3 text-sm font-medium text-ink-500">
              Super Admin · fixed
            </div>
          ) : (
            <Select
              id="edit-role"
              className="h-11"
              value={role}
              disabled={isSelf}
              onChange={(event) => setRole(event.target.value as "admin" | "user")}
            >
              <option value="user">Member</option>
              <option value="admin">Admin</option>
            </Select>
          )}
        </Field>
      </div>

      {isSelf && (
        <p className="text-xs text-ink-400">
          Status is locked on your own account, so you cannot lock yourself out.
        </p>
      )}

      <Field label="Set a new password" hint="(leave blank to keep the current one)" htmlFor="edit-password">
        <Input
          id="edit-password"
          type={showPassword ? "text" : "password"}
          className="h-11"
          icon={<KeyRound className="text-ink-500" />}
          placeholder="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          name="edit-password"
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

      {isManager ? (
        <div className="rounded-field border border-line bg-ink-50 px-3.5 py-3">
          <p className="text-sm font-semibold text-ink-800">Departments</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {isFixedRole ? "A super admin" : "An admin"} works across the whole workspace, so they
            are not a member of any department.
          </p>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-800">
            Departments
            <span className="ml-1.5 font-normal text-ink-400">
              tick each one and set the role ({memberships.length} selected)
            </span>
          </p>
          <DepartmentRolePicker
            departments={departments}
            value={memberships}
            onChange={setMemberships}
          />
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- delete */

function DeleteUserModal({
  user,
  onClose,
  onDeleted,
}: {
  user: DirectoryUser | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!user) return;
    setPending(true);
    try {
      await deleteUser(user.id);
      onDeleted(user.id);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title={`Delete ${user?.name ?? ""}?`}
      description="The account is removed from every department and can no longer sign in."
      className="max-w-md"
    >
      {error && <Banner message={error} />}
      <p className="text-sm text-ink-600">
        This permanently deletes <span className="font-semibold text-ink-900">{user?.email}</span>.
        It cannot be undone.
      </p>
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={pending}>
          {pending ? "Deleting…" : "Delete User"}
        </Button>
      </div>
    </Modal>
  );
}
