"use client";

import type { AdminListEntry } from "@/lib/admins/admin-list-entry";

type InviteConflictProps = {
  readonly pending: AdminListEntry;
  readonly onResend: () => void;
  readonly onRevoke: () => void;
};

/** Shown in the invite dialog after a 409 for an email that has a pending invitation: offers its resend and revoke. */
export function InviteConflict({ pending, onResend, onRevoke }: InviteConflictProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{pending.email} already has a pending invitation:</span>
      <button type="button" onClick={onResend} className="rounded border border-neutral-300 px-2 py-1">Resend invitation</button>
      <button type="button" onClick={onRevoke} className="rounded border border-neutral-300 px-2 py-1">Revoke invitation</button>
    </div>
  );
}
