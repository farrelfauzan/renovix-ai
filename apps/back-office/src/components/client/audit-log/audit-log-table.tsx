"use client";

import type { AuditLogRow } from "@/lib/audit-log/audit-log-row";
import { AuditLogValue } from "./audit-log-value";

const COLUMNS = ["Admin", "Resource", "Action", "Before", "After", "Reason", "Effective time"];

/** The audit log rows (RX-164), as the API returned them (already masked where needed). */
export function AuditLogTable({ rows }: { rows: readonly AuditLogRow[] }) {
  if (!rows.length) return <p className="text-sm text-rx-muted">No audit rows match these filters.</p>;
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column} className="border-b border-rx-line px-2 py-1 font-medium">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="align-top">
            <td className="border-b border-rx-line px-2 py-1" title={row.adminId}>{row.adminEmail}</td>
            <td className="border-b border-rx-line px-2 py-1">{row.resource}</td>
            <td className="border-b border-rx-line px-2 py-1">{row.action}</td>
            <td className="border-b border-rx-line px-2 py-1"><AuditLogValue value={row.before} /></td>
            <td className="border-b border-rx-line px-2 py-1"><AuditLogValue value={row.after} /></td>
            <td className="border-b border-rx-line px-2 py-1">{row.reason}</td>
            <td className="border-b border-rx-line px-2 py-1">{row.effectiveAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
