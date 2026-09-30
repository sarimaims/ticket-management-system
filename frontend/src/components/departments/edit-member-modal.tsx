"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PhoneInput } from "@/components/ui/phone-input";
import { errorMessage } from "@/lib/api";
import { updateMemberDetails, type Member } from "@/lib/departments";
import { isPhone, PHONE_HELP, toStoredPhone } from "@/lib/phone";

/**
 * A member's details, as the department that has them sees them: the name
 * they go by, the number to reach them on, and what they do.
 *
 * What they sign in with and what they may do - email, password, role and
 * status - is not here. That stays on the admin's Users page.
 */
export function EditMemberModal({
  departmentId,
  member,
  onClose,
  onSaved,
}: {
  departmentId: string;
  member: Member | null;
  onClose: () => void;
  onSaved: (member: Member) => void;
}) {
  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      title="Edit member"
      description="Their name, phone and designation. Email, password and role are changed by an admin."
      className="max-w-md"
    >
      {member && (
        <MemberForm
          key={member.id}
          departmentId={departmentId}
          member={member}
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
  onClose,
  onSaved,
}: {
  departmentId: string;
  member: Member;
  onClose: () => void;
  onSaved: (member: Member) => void;
}) {
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone ?? "");
  const [title, setTitle] = useState(member.designation ?? "");
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
    if (title.trim() !== (member.designation ?? "")) changes.designation = title.trim();
    if (Object.keys(changes).length === 0) return onClose();

    setPending(true);
    try {
      onSaved(await updateMemberDetails(departmentId, member.id, changes));
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
