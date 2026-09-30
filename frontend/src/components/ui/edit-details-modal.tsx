"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { errorMessage } from "@/lib/api";

/** The API holds the same limits for departments and units. */
const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;

export type DetailsDraft = { name: string; description: string; unit?: string };

/**
 * Editing a department or a unit: its name, what it does, and - for a
 * department, and only for an admin - which unit it sits under.
 *
 * Only what changed is handed to `onSave`, so a head who cannot move a
 * department never sends the unit, and an unchanged form sends nothing. The
 * API's refusal is shown beside the form rather than as a toast.
 */
export function EditDetailsModal({
  open,
  title,
  hint,
  nameLabel,
  current,
  units,
  onClose,
  onSave,
}: {
  open: boolean;
  /** "Edit department". */
  title: string;
  hint?: string;
  /** "Department name". */
  nameLabel: string;
  current: DetailsDraft;
  /** Given only when the reader may move it: the units it can sit under. */
  units?: { id: string; name: string }[];
  onClose: () => void;
  /** Saves what changed. Throws with the API's reason when it is refused. */
  onSave: (changes: Partial<DetailsDraft>) => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={hint} className="max-w-md">
      {/* Keyed so reopening starts from what is saved, not the last draft. */}
      {open && (
        <DetailsForm
          key={`${current.name}|${current.description}|${current.unit ?? ""}`}
          nameLabel={nameLabel}
          current={current}
          units={units}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Modal>
  );
}

function DetailsForm({
  nameLabel,
  current,
  units,
  onClose,
  onSave,
}: {
  nameLabel: string;
  current: DetailsDraft;
  units?: { id: string; name: string }[];
  onClose: () => void;
  onSave: (changes: Partial<DetailsDraft>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DetailsDraft>(current);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const changes: Partial<DetailsDraft> = {};
  if (draft.name.trim() !== current.name.trim()) changes.name = draft.name.trim();
  if (draft.description.trim() !== current.description.trim()) {
    changes.description = draft.description.trim();
  }
  if (units && draft.unit && draft.unit !== current.unit) changes.unit = draft.unit;
  const dirty = Object.keys(changes).length > 0;

  const set = (patch: Partial<DetailsDraft>) => {
    setDraft((before) => ({ ...before, ...patch }));
    setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return setError("It needs a name.");
    if (!dirty) return onClose();

    setPending(true);
    try {
      await onSave(changes);
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

      <Field label={nameLabel} required htmlFor="details-name">
        <Input
          id="details-name"
          value={draft.name}
          maxLength={MAX_NAME}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>

      <Field label="Description" hint="(optional)" htmlFor="details-description">
        <Textarea
          id="details-description"
          value={draft.description}
          maxLength={MAX_DESCRIPTION}
          rows={3}
          placeholder="What this handles, in a line or two"
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      {units && (
        <Field
          label="Unit"
          htmlFor="details-unit"
          help="Moving it takes its members and its tickets along."
        >
          <Select
            id="details-unit"
            value={draft.unit ?? ""}
            onChange={(event) => set({ unit: event.target.value })}
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3.5">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !draft.name.trim() || !dirty}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
