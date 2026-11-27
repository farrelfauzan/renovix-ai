"use client";

import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { AdminActionButton } from "./admin-action-button";

type AdminDetailActionsProps = {
  readonly entry: AdminListEntry;
  readonly api: AdminsApi;
  readonly onAct: (action: () => Promise<unknown>) => void;
  readonly onResend: (id: string) => void;
};

/** The account actions of an admin's detail (`admins:write`), by status: an invitation has Resend and Revoke only. */
export function AdminDetailActions({ entry, api, onAct, onResend }: AdminDetailActionsProps) {
  if (entry.status === "invited") {
    return (
      <div className="flex flex-wrap gap-2">
        <AdminActionButton label="Resend" onClick={() => onResend(entry.id)} />
        <AdminActionButton label="Revoke" onClick={() => onAct(() => api.revokeInvitation(entry.id))} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entry.status === "active" && <AdminActionButton label="Suspend / remove access" onClick={() => onAct(() => api.suspend(entry.id))} />}
      {entry.status === "suspended" && <AdminActionButton label="Reactivate" onClick={() => onAct(() => api.reactivate(entry.id))} />}
      <AdminActionButton label="Reset MFA" onClick={() => onAct(() => api.resetMfa(entry.id))} />
      <AdminActionButton label="Force password reset" onClick={() => onAct(() => api.forcePasswordReset(entry.id))} />
    </div>
  );
}
