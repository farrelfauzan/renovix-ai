"use client";

import { useState } from "react";
import type { ActionOutcome } from "@/lib/admins/action-outcome";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { RoleInput } from "@/lib/admins/role-input";
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

/** The roles screen: every role with its permissions, create and edit for custom roles, delete of a custom role. */
export function RolesPanel({ roles, api, canWrite, run, onAct }: RolesPanelProps) {
  const [form, setForm] = useState<{ readonly role?: AdminRole } | null>(null);
  const save = async (input: RoleInput): Promise<string | null> => {
    const editing = form?.role;
    const changes = editing ? { ...(input.name !== editing.name && { name: input.name }), permissions: input.permissions } : input;
    const outcome = await run(() => (editing ? api.updateRole(editing.name, changes) : api.createRole(input)));
    return outcome.ok ? null : outcome.message;
  };
  return (
    <section aria-label="Roles" className="mt-6">
      <h2 className="text-lg font-semibold">Roles</h2>
      {canWrite && <button type="button" onClick={() => setForm({})} className="mt-2 rounded-rx border border-rx-line px-3 py-1 text-sm">Create role</button>}
      {form && <RoleForm key={form.role?.name ?? "new"} role={form.role} onSave={save} onClose={() => setForm(null)} />}
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
            <RoleRow key={role.name} role={role} canWrite={canWrite} onEdit={() => setForm({ role })} onDelete={() => onAct(() => api.deleteRole(role.name))} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
