"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PhoneInput } from "@/components/ui/phone-input";
import { errorMessage } from "@/lib/api";
import type { DepartmentRole } from "@/lib/auth";
import { updateMemberDetails, updateMemberRole, type Member } from "@/lib/departments";
import { isPhone, PHONE_HELP, toStoredPhone } from "@/lib/phone";

/**
 * A member's details, as the department that has them sees them: the name
 * they go by, the number to reach them on, and what they do.
 *
 * An admin also sets their role here - head or user - which the API allows
 * no one else. What they sign in with - email, password and status - stays
 * on the admin's Users page.
 */
export function EditMemberModal({
  departmentId,
  member,
  canChangeRole,
  onClose,
  onSaved,
}: {
  departmentId: string;
  member: Member | null;
  /** Admins only: the API refuses a role change from anyone else. */
  canChangeRole: boolean;
  onClose: () => void;
  onSaved: (member: Member, roleChanged: boolean) => void;
}) {
  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      title="Edit member"
      description={
        canChangeRole
          ? "Their name, phone, designation and role in this department."
          : "Their name, phone and designation. Email, password and role are changed by an admin."
      }
      className="max-w-md"
    >
      {member && (
        <MemberForm
          key={member.id}
          departmentId={departmentId}
          member={member}
          canChangeRole={canChangeRole}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function MemberForm({
  departmentId,
  member,
  canChangeRole,
  onClose,
  onSaved,
}: {
  departmentId: string;
  member: Member;
  canChangeRole: boolean;
  onClose: () => void;
  onSaved: (member: Member, roleChanged: boolean) => void;
}) {
  // Their title here: it belongs to the role in this department, so that is
  // where it is read from - the account's own is only a fallback.
  const current =
    member.departments.find((item) => item.id === departmentId)?.designation?.trim() ||
    member.designation?.trim() ||
    "";
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone ?? "");
  const [title, setTitle] = useState(current);
  const [role, setRole] = useState<DepartmentRole>(member.departmentRole);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter their full name.");
    if (!isPhone(phone)) return setError(PHONE_HELP);
    if (title.trim().length < 2) return setError("Enter their designation.");

    const changes: { name?: string; phone?: string; designation?: string } = {};
    if (name.trim() !== member.name) changes.name = name.trim();
    if (toStoredPhone(phone) !== (member.phone ?? "")) changes.phone = toStoredPhone(phone);
    if (title.trim() !== current) changes.designation = title.trim();
    const roleChanged = canChangeRole && role !== member.departmentRole;
    if (Object.keys(changes).length === 0 && !roleChanged) return onClose();

    setPending(true);
    try {
      let saved = member;
      if (Object.keys(changes).length > 0) {
        saved = await updateMemberDetails(departmentId, member.id, changes);
      }
      if (roleChanged) {
        await updateMemberRole(departmentId, member.id, role);
        saved = { ...saved, departmentRole: role };
      }
      onSaved(saved, roleChanged);
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  return (
    <form className="space-y-3.5" onSubmit={submit} noValidate>
      {error && (
        <p role="alert" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] font-medium text-brand-700">
          {error}
        </p>
      )}

      <p className="rounded-md bg-ink-50 px-3 py-2 text-[12px] text-ink-500">
        Signs in as <span className="font-semibold text-ink-800">{member.email}</span>
      </p>

      <Field label="Full name" required htmlFor="member-edit-name">
        <Input
          id="member-edit-name"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
      </Field>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Phone number" required htmlFor="member-edit-phone">
          <PhoneInput
            id="member-edit-phone"
            placeholder="+971 50 123 4567"
            value={phone}
            onChange={(next) => {
              setPhone(next);
              setError("");
            }}
          />
        </Field>

        <Field label="Designation" required htmlFor="member-edit-designation">
          <Input
            id="member-edit-designation"
            value={title}
            maxLength={80}
            placeholder="e.g. HR Executive"
            onChange={(event) => {
              setTitle(event.target.value);
              setError("");
            }}
          />
        </Field>
      </div>

      {canChangeRole && (
        <Field label="Role in this department" required htmlFor="member-edit-role">
          <Select
            id="member-edit-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as DepartmentRole);
              setError("");
            }}
          >
            <option value="head">Head</option>
            <option value="team">User</option>
          </Select>
        </Field>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3.5">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
