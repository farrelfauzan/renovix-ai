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

/**
 * The role change of an admin's detail (`roles:write`; never rendered on the signed-in admin's own detail): picking
 * a role changes nothing until Save (D436).
 */
export function AssignRoleControl({ email, currentRole, roles, onAssign }: AssignRoleControlProps) {
  const [role, setRole] = useState(currentRole);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-rx-muted">Change role</span>
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger aria-label={`Role for ${email}`} className="rounded-rx border-rx-line px-2 py-1 data-[size=default]:h-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((entry) => (
            <SelectItem key={entry.name} value={entry.name}>{entry.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" type="button" aria-label={`Save role for ${email}`} onClick={() => onAssign(role)} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Save</Button>
    </div>
  );
}
