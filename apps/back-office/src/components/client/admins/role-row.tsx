"use client";

import { Pencil, Trash2 } from "lucide-react";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import type { AdminRole } from "@/lib/admins/admin-role";

type RoleRowProps = {
  readonly role: AdminRole;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

const CELL = "border-b border-rx-line px-2 py-1";

/** One role; built-in roles are read-only (no edit, no delete control). */
export function RoleRow({ role, canWrite, onEdit, onDelete }: RoleRowProps) {
  const canChange = canWrite && !role.builtIn;
  return (
    <tr className="align-top">
      <td className={CELL}>{role.name}</td>
      <td className={CELL}>{role.builtIn ? "built-in" : "custom"}</td>
      <td className={CELL}>{role.permissions.join(", ")}</td>
      <td className={`${CELL} flex gap-1`}>
        {canChange && <IconActionButton title="Edit" label={`Edit role ${role.name}`} icon={Pencil} onClick={onEdit} />}
        {canChange && <IconActionButton title="Delete" tone="destructive" label={`Delete role ${role.name}`} icon={Trash2} onClick={onDelete} />}
      </td>
    </tr>
  );
}
