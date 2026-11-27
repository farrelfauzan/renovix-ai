"use client";

import { useState } from "react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { ReasonRequest } from "@/lib/admins/reason-request";
import { AdminActionButton } from "./admin-action-button";
import { ReasonDialog } from "./reason-dialog";

type AdminDetailActionsProps = {
  readonly entry: AdminListEntry;
  readonly api: AdminsApi;
  readonly onAct: (action: () => Promise<unknown>) => void;
  readonly onResend: (id: string, reason: string) => void;
};

/**
 * The account actions of an admin's detail (`admins:write`), by status: an invitation has Resend and Revoke only.
 * Each asks for its reason in the reason dialog first (RNX-370); nothing is sent until it is confirmed.
 */
export function AdminDetailActions({ entry, api, onAct, onResend }: AdminDetailActionsProps) {
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const ask = (title: string, confirm: (reason: string) => void) => () => setRequest({ title: `${title} ${entry.email}`, confirm });
  if (entry.status === "invited") {
    return (
      <div className="flex flex-wrap gap-2">
        <AdminActionButton label="Resend" onClick={ask("Resend the invitation of", (reason) => onResend(entry.id, reason))} />
        <AdminActionButton label="Revoke" onClick={ask("Revoke the invitation of", (reason) => onAct(() => api.revokeInvitation(entry.id, reason)))} />
        {request && <ReasonDialog request={request} onClose={() => setRequest(null)} />}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entry.status === "active" && <AdminActionButton label="Suspend / remove access" onClick={ask("Suspend", (reason) => onAct(() => api.suspend(entry.id, reason)))} />}
      {entry.status === "suspended" && <AdminActionButton label="Reactivate" onClick={ask("Reactivate", (reason) => onAct(() => api.reactivate(entry.id, reason)))} />}
      <AdminActionButton label="Reset MFA" onClick={ask("Reset the MFA of", (reason) => onAct(() => api.resetMfa(entry.id, reason)))} />
      <AdminActionButton label="Force password reset" onClick={ask("Force a password reset for", (reason) => onAct(() => api.forcePasswordReset(entry.id, reason)))} />
      {request && <ReasonDialog request={request} onClose={() => setRequest(null)} />}
    </div>
  );
}
