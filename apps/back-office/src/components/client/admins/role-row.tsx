"use client";

import type { AdminRole } from "@/lib/admins/admin-role";

type RoleRowProps = {
  readonly role: AdminRole;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

const CELL = "border-b border-neutral-100 px-2 py-1";

/** One role; built-in roles are read-only (no edit, no delete control). */
export function RoleRow({ role, canWrite, onEdit, onDelete }: RoleRowProps) {
  const canChange = canWrite && !role.builtIn;
  return (
    <tr className="align-top">
      <td className={CELL}>{role.name}</td>
      <td className={CELL}>{role.builtIn ? "built-in" : "custom"}</td>
      <td className={CELL}>{role.permissions.join(", ")}</td>
      <td className={`${CELL} flex gap-1`}>
        {canChange && <button type="button" aria-label={`Edit role ${role.name}`} onClick={onEdit} className="rounded border border-neutral-300 px-2 py-1 text-sm">Edit</button>}
        {canChange && <button type="button" aria-label={`Delete role ${role.name}`} onClick={onDelete} className="rounded border border-neutral-300 px-2 py-1 text-sm">Delete</button>}
      </td>
    </tr>
  );
}
