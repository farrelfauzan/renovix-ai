"use client";

import { Button } from "@performa-ai/ui/components/button";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";

type InviteConflictProps = {
  readonly pending: AdminListEntry;
  /** No reason in the invite form yet (RNX-370): both actions are disabled. */
  readonly isDisabled: boolean;
  readonly onResend: () => void;
  readonly onRevoke: () => void;
};

/** Shown in the invite dialog after a 409 for an email that has a pending invitation: offers its resend and revoke. */
export function InviteConflict({ pending, isDisabled, onResend, onRevoke }: InviteConflictProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{pending.email} already has a pending invitation:</span>
      <Button variant="outline" type="button" disabled={isDisabled} onClick={onResend} className="rounded-rx border border-rx-line px-2 py-1 h-auto bg-transparent font-normal whitespace-normal">Resend invitation</Button>
      <Button variant="outline" type="button" disabled={isDisabled} onClick={onRevoke} className="rounded-rx border border-rx-line px-2 py-1 h-auto bg-transparent font-normal whitespace-normal">Revoke invitation</Button>
    </div>
  );
}
