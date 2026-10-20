"use client";

import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { AdminRow } from "./admin-row";

const COLUMNS = ["Name", "Email", "Role", "MFA", "Last sign-in", "Status", "Actions"];

type AdminsTableProps = {
  readonly admins: readonly AdminListEntry[];
  readonly api: AdminsApi;
  readonly roles: readonly AdminRole[];
  readonly currentAdminId: string;
  readonly canWriteAdmins: boolean;
  readonly canWriteRoles: boolean;
  readonly onAct: (action: () => Promise<unknown>) => void;
  readonly onResend: (id: string) => void;
};

/** The admins and pending invitations (RNX-189). */
export function AdminsTable({ admins, api, roles, currentAdminId, canWriteAdmins, canWriteRoles, onAct, onResend }: AdminsTableProps) {
  return (
    <table aria-label="Admins" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column} className="border-b border-neutral-200 px-2 py-1 font-medium">{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {admins.map((entry) => (
          <AdminRow key={entry.id} entry={entry} api={api} roles={roles} isOwnRow={entry.id === currentAdminId} canWriteAdmins={canWriteAdmins} canWriteRoles={canWriteRoles} onAct={onAct} onResend={onResend} />
        ))}
      </tbody>
    </table>
  );
}
