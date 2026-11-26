"use client";

import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import { AdminRow } from "./admin-row";

const COLUMNS = ["Name", "Email", "Role", "MFA", "Last sign-in", "Status", "Actions"];

type AdminsTableProps = {
  readonly admins: readonly AdminListEntry[];
  readonly selectedId: string | null;
  readonly onOpen: (id: string) => void;
};

/** The admins and pending invitations (RNX-189). */
export function AdminsTable({ admins, selectedId, onOpen }: AdminsTableProps) {
  return (
    <table aria-label="Admins" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column} className="border-b border-rx-line px-2 py-1 font-medium">{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {admins.map((entry) => (
          <AdminRow key={entry.id} entry={entry} isSelected={entry.id === selectedId} onOpen={() => onOpen(entry.id)} />
        ))}
      </tbody>
    </table>
  );
}
