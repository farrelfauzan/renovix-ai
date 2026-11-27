"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import type { ActionOutcome } from "@/lib/admins/action-outcome";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { RoleInput } from "@/lib/admins/role-input";
import { ReasonDialog } from "./reason-dialog";
import { RoleForm } from "./role-form";
import { RoleRow } from "./role-row";

const COLUMNS = ["Role", "Kind", "Permissions", "Actions"];

type RolesPanelProps = {
  readonly roles: readonly AdminRole[];
  readonly api: AdminsApi;
  readonly canWrite: boolean;
  readonly run: <T>(action: () => Promise<T>) => Promise<ActionOutcome<T>>;
  readonly onAct: (action: () => Promise<unknown>) => void;
};

/**
 * The roles screen: every role with its permissions, create and edit for custom roles, delete of a custom role. Every
 * write carries a reason (RNX-370): the role form asks for it, a delete asks in the reason dialog.
 */
export function RolesPanel({ roles, api, canWrite, run, onAct }: RolesPanelProps) {
  const [form, setForm] = useState<{ readonly role?: AdminRole } | null>(null);
  const [deleting, setDeleting] = useState<AdminRole | null>(null);
  const save = async (input: RoleInput, reason: string): Promise<string | null> => {
    const editing = form?.role;
    const changes = editing ? { ...(input.name !== editing.name && { name: input.name }), permissions: input.permissions } : input;
    const outcome = await run(() => (editing ? api.updateRole(editing.name, changes, reason) : api.createRole(input, reason)));
    return outcome.ok ? null : outcome.message;
  };
  return (
    <section aria-label="Roles" className="mt-6">
      <h2 className="text-lg font-semibold">Roles</h2>
      {canWrite && <Button variant="outline" type="button" onClick={() => setForm({})} className="mt-2 rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Create role</Button>}
      {form && <RoleForm key={form.role?.name ?? "new"} role={form.role} onSave={save} onClose={() => setForm(null)} />}
      {deleting && <ReasonDialog request={{ title: `Delete role ${deleting.name}`, confirm: (reason) => onAct(() => api.deleteRole(deleting.name, reason)) }} onClose={() => setDeleting(null)} />}
      <table aria-label="Roles" className="mt-2 w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} className="border-b border-rx-line px-2 py-1 font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <RoleRow key={role.name} role={role} canWrite={canWrite} onEdit={() => setForm({ role })} onDelete={() => setDeleting(role)} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
