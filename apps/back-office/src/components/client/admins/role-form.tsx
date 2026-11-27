"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Checkbox } from "@performa-ai/ui/components/checkbox";
import { Input } from "@performa-ai/ui/components/input";
import type { AdminRole } from "@/lib/admins/admin-role";
import { MAX_REASON_LENGTH } from "@/lib/admins/max-reason-length";
import type { RoleInput } from "@/lib/admins/role-input";
import { OWNER_ONLY_PERMISSIONS, STAFF_PERMISSIONS } from "@/lib/admins/staff-permissions";
import { LabeledInput } from "../form/labeled-input";

const OFFERED_PERMISSIONS = STAFF_PERMISSIONS.filter((permission) => !OWNER_ONLY_PERMISSIONS.includes(permission));

type RoleFormProps = {
  /** The custom role being edited; none: a new role. */
  readonly role?: AdminRole;
  /** Saves the role with the reason (RNX-370); answers the API's refusal text, or null when it was saved. */
  readonly onSave: (input: RoleInput, reason: string) => Promise<string | null>;
  readonly onClose: () => void;
};

/**
 * Create or edit a custom role: a name and the permissions it holds, chosen from the permission list, and the
 * required reason (RNX-370): without one Save role is disabled and nothing is sent.
 */
export function RoleForm({ role, onSave, onClose }: RoleFormProps) {
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState<readonly string[]>(role?.permissions ?? []);
  const [reason, setReason] = useState("");
  const isReasonEmpty = reason.trim() === "";
  const [error, setError] = useState<string | null>(null);
  const toggle = (permission: string) =>
    setPermissions((held) => (held.includes(permission) ? held.filter((entry) => entry !== permission) : [...held, permission]));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReasonEmpty) return;
    const message = await onSave({ name, permissions }, reason.trim());
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form role="dialog" aria-label={role ? `Edit role ${role.name}` : "Create a role"} onSubmit={submit} className="mt-4 flex max-w-xl flex-col gap-3 rounded-rx border border-rx-line p-4">
      <label className="flex flex-col gap-1 text-sm">
        Role name
        <Input name="name" required pattern="[a-z][a-z0-9_\-]{0,63}" value={name} onChange={(event) => setName(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      <fieldset className="grid grid-cols-2 gap-1 text-sm">
        <legend className="mb-1">Permissions (admins:write and roles:write stay with the Owner role)</legend>
        {OFFERED_PERMISSIONS.map((permission) => (
          <label key={permission} className="flex items-center gap-2">
            <Checkbox checked={permissions.includes(permission)} onCheckedChange={() => toggle(permission)} />
            {permission}
          </label>
        ))}
      </fieldset>
      <LabeledInput label="Reason (required, audited)" name="reason" isRequired maxLength={MAX_REASON_LENGTH} value={reason} onChange={setReason} />
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" type="submit" disabled={isReasonEmpty} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Save role</Button>
        <Button variant="outline" type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Cancel</Button>
      </div>
    </form>
  );
}
