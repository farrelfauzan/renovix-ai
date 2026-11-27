"use client";

import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import { describeAdminStatus } from "@/lib/admins/describe-admin-status";
import { AdminOpenLink } from "./admin-open-link";

const CELL = "border-b border-rx-line px-2 py-1";

/** One row of the admin list; its only action opens the admin's page, which holds every write (RNX-373, D443). */
export function AdminRow({ entry }: { readonly entry: AdminListEntry }) {
  return (
    <tr className="align-top">
      <td className={CELL}>{entry.name ?? "-"}</td>
      <td className={CELL}>{entry.email}</td>
      <td className={CELL}>{entry.role}</td>
      <td className={CELL}>{entry.mfa === "enrolled" ? "enrolled" : "not enrolled"}</td>
      <td className={CELL}>{entry.lastSignInAt ?? "never"}</td>
      <td className={CELL}>{describeAdminStatus(entry)}</td>
      <td className={CELL}>
        <AdminOpenLink id={entry.id} email={entry.email} />
      </td>
    </tr>
  );
}
