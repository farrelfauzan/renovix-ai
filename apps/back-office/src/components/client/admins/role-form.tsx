"use client";

import { useState, type FormEvent } from "react";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { RoleInput } from "@/lib/admins/role-input";
import { OWNER_ONLY_PERMISSIONS, STAFF_PERMISSIONS } from "@/lib/admins/staff-permissions";

const OFFERED_PERMISSIONS = STAFF_PERMISSIONS.filter((permission) => !OWNER_ONLY_PERMISSIONS.includes(permission));

type RoleFormProps = {
  /** The custom role being edited; none: a new role. */
  readonly role?: AdminRole;
  /** Saves the role; answers the API's refusal text, or null when it was saved. */
  readonly onSave: (input: RoleInput) => Promise<string | null>;
  readonly onClose: () => void;
};

/** Create or edit a custom role: a name and the permissions it holds, chosen from the permission list. */
export function RoleForm({ role, onSave, onClose }: RoleFormProps) {
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState<readonly string[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const toggle = (permission: string) =>
    setPermissions((held) => (held.includes(permission) ? held.filter((entry) => entry !== permission) : [...held, permission]));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = await onSave({ name, permissions });
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form role="dialog" aria-label={role ? `Edit role ${role.name}` : "Create a role"} onSubmit={submit} className="mt-4 flex max-w-xl flex-col gap-3 rounded-rx border border-rx-line p-4">
      <label className="flex flex-col gap-1 text-sm">
        Role name
        <input name="name" required pattern="[a-z][a-z0-9_\-]{0,63}" value={name} onChange={(event) => setName(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1" />
      </label>
      <fieldset className="grid grid-cols-2 gap-1 text-sm">
        <legend className="mb-1">Permissions (admins:write and roles:write stay with the Owner role)</legend>
        {OFFERED_PERMISSIONS.map((permission) => (
          <label key={permission} className="flex items-center gap-2">
            <input type="checkbox" checked={permissions.includes(permission)} onChange={() => toggle(permission)} />
            {permission}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-rx border border-rx-line px-3 py-1 text-sm">Save role</button>
        <button type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm">Cancel</button>
      </div>
    </form>
  );
}
