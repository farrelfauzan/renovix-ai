"use client";

import { useEffect, useRef } from "react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { describeAdminStatus } from "@/lib/admins/describe-admin-status";
import { AdminDetailActions } from "./admin-detail-actions";
import { AssignRoleControl } from "./assign-role-control";

type AdminDetailPanelProps = {
  readonly entry: AdminListEntry;
  readonly api: AdminsApi;
  readonly roles: readonly AdminRole[];
  /** The signed-in admin's own detail: no role change is offered. */
  readonly isOwnDetail: boolean;
  readonly canWriteAdmins: boolean;
  readonly canWriteRoles: boolean;
  /** Runs an API call with the re-authentication prompt, then refetches; shows the API's refusal. */
  readonly onAct: (action: () => Promise<unknown>) => void;
  /** Resends the invitation with the reason (RNX-370) and shows its new link once. */
  readonly onResend: (id: string, reason: string) => void;
};

/**
 * The detail of one admin or pending invitation (RNX-373), from its list entry: no request of its own. It holds every
 * write that the admins table had in its rows; its controls follow the permissions (visibility only: the API
 * enforces them). Its heading takes the focus when the page opens.
 */
export function AdminDetailPanel({ entry, api, roles, isOwnDetail, canWriteAdmins, canWriteRoles, onAct, onResend }: AdminDetailPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const isInvited = entry.status === "invited";
  const fields: readonly (readonly [string, string])[] = [
    ["Name", entry.name ?? "-"],
    ["Email", entry.email],
    ["Role", entry.role],
    ["MFA", entry.mfa === "enrolled" ? "enrolled" : "not enrolled"],
    ["Last sign-in", entry.lastSignInAt ?? "never"],
    [isInvited ? "Invitation" : "Status", describeAdminStatus(entry)],
    ...(isInvited && entry.invitationExpiresAt ? [["Invitation expires", entry.invitationExpiresAt] as const] : []),
  ];
  return (
    <section aria-labelledby="admin-detail-heading" className="flex min-w-0 flex-col gap-4 rounded-rx border border-rx-line p-[18px] narrow:p-3.5">
      <h2 id="admin-detail-heading" ref={headingRef} tabIndex={-1} className="break-all text-lg font-semibold outline-none">
        Admin <span className="font-mono">{entry.email}</span>
      </h2>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {fields.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-rx-muted">{term}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {canWriteRoles && !isInvited && !isOwnDetail && (
        <AssignRoleControl email={entry.email} currentRole={entry.role} roles={roles} onAssign={(role, reason) => onAct(() => api.assignRole(entry.id, role, reason))} />
      )}
      {canWriteAdmins && <AdminDetailActions entry={entry} api={api} onAct={onAct} onResend={onResend} />}
    </section>
  );
}
