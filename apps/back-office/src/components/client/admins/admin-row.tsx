"use client";

import { ExternalLink } from "lucide-react";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import { describeAdminStatus } from "@/lib/admins/describe-admin-status";

type AdminRowProps = {
  readonly entry: AdminListEntry;
  readonly isSelected: boolean;
  /** Opens this admin's detail, which holds every write (RNX-373). */
  readonly onOpen: () => void;
};

const CELL = "border-b border-rx-line px-2 py-1";

/** One row of the admin list; its only action opens the admin's detail. */
export function AdminRow({ entry, isSelected, onOpen }: AdminRowProps) {
  return (
    <tr className={`align-top ${isSelected ? "bg-rx-accent-fill" : ""}`}>
      <td className={CELL}>{entry.name ?? "-"}</td>
      <td className={CELL}>{entry.email}</td>
      <td className={CELL}>{entry.role}</td>
      <td className={CELL}>{entry.mfa === "enrolled" ? "enrolled" : "not enrolled"}</td>
      <td className={CELL}>{entry.lastSignInAt ?? "never"}</td>
      <td className={CELL}>{describeAdminStatus(entry)}</td>
      <td className={CELL}>
        <IconActionButton title="Open" label={`Open admin ${entry.email}`} icon={ExternalLink} onClick={onOpen} />
      </td>
    </tr>
  );
}
