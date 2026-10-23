"use client";

import type { ActionOutcome } from "@/lib/admins/action-outcome";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { IssuedInvitation } from "@/lib/admins/issued-invitation";
import { useState } from "react";
import { AdminsTable } from "./admins-table";
import { InviteDialog } from "./invite-dialog";

type AdminsPanelProps = {
  readonly admins: readonly AdminListEntry[];
  readonly roles: readonly AdminRole[];
  readonly api: AdminsApi;
  readonly currentAdminId: string;
  readonly canWriteAdmins: boolean;
  readonly canWriteRoles: boolean;
  readonly run: <T>(action: () => Promise<T>) => Promise<ActionOutcome<T>>;
  readonly onAct: (action: () => Promise<unknown>) => void;
  readonly onIssued: (issued: IssuedInvitation) => void;
  readonly onResend: (id: string) => void;
};

/** The admin list with its invite dialog (`admins:read`; the write controls follow `admins:write` and `roles:write`). */
export function AdminsPanel({ admins, roles, api, currentAdminId, canWriteAdmins, canWriteRoles, run, onAct, onIssued, onResend }: AdminsPanelProps) {
  const [isInviting, setIsInviting] = useState(false);
  return (
    <section aria-label="Admins" className="mt-4">
      <h2 className="text-lg font-semibold">Admins</h2>
      {canWriteAdmins && <button type="button" onClick={() => setIsInviting(true)} className="mt-2 rounded-rx border border-rx-line px-3 py-1 text-sm">Invite admin</button>}
      {isInviting && <InviteDialog api={api} roles={roles} admins={admins} run={run} onIssued={onIssued} onClose={() => setIsInviting(false)} />}
      <AdminsTable admins={admins} api={api} roles={roles} currentAdminId={currentAdminId} canWriteAdmins={canWriteAdmins} canWriteRoles={canWriteRoles} onAct={onAct} onResend={onResend} />
    </section>
  );
}
