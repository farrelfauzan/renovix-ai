"use client";

import { useState } from "react";
import type { AdminRole } from "@/lib/admins/admin-role";

type AssignRoleControlProps = {
  readonly email: string;
  readonly currentRole: string;
  readonly roles: readonly AdminRole[];
  readonly onAssign: (role: string) => void;
};

/** The role select and its button on an admin row (`roles:write`; never rendered on the signed-in admin's own row). */
export function AssignRoleControl({ email, currentRole, roles, onAssign }: AssignRoleControlProps) {
  const [role, setRole] = useState(currentRole);
  return (
    <span className="inline-flex gap-1">
      <select aria-label={`Role for ${email}`} value={role} onChange={(event) => setRole(event.target.value)} className="rounded-rx border border-rx-line px-1 py-1 text-sm">
        {roles.map((entry) => (
          <option key={entry.name} value={entry.name}>{entry.name}</option>
        ))}
      </select>
      <button type="button" aria-label={`Assign role to ${email}`} onClick={() => onAssign(role)} className="rounded-rx border border-rx-line px-2 py-1 text-sm">Assign</button>
    </span>
  );
}
