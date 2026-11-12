"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
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
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger aria-label={`Role for ${email}`} className="rounded-rx border-rx-line px-1 py-1 data-[size=default]:h-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((entry) => (
            <SelectItem key={entry.name} value={entry.name}>{entry.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" type="button" aria-label={`Assign role to ${email}`} onClick={() => onAssign(role)} className="rounded-rx border border-rx-line px-2 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Assign</Button>
    </span>
  );
}
