"use client";

import { Button } from "@performa-ai/ui/components/button";
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
  readonly canWriteAdmins: boolean;
  readonly run: <T>(action: () => Promise<T>) => Promise<ActionOutcome<T>>;
  readonly onIssued: (issued: IssuedInvitation) => void;
};

/** The admin list with its invite dialog (`admins:read`; inviting follows `admins:write`). A row opens the admin's page. */
export function AdminsPanel({ admins, roles, api, canWriteAdmins, run, onIssued }: AdminsPanelProps) {
  const [isInviting, setIsInviting] = useState(false);
  return (
    <section aria-label="Admins" className="mt-4">
      <h2 className="text-lg font-semibold">Admins</h2>
      {canWriteAdmins && <Button variant="outline" type="button" onClick={() => setIsInviting(true)} className="mt-2 rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Invite admin</Button>}
      {isInviting && <InviteDialog api={api} roles={roles} admins={admins} run={run} onIssued={onIssued} onClose={() => setIsInviting(false)} />}
      <AdminsTable admins={admins} />
    </section>
  );
}
