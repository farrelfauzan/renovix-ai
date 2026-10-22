"use client";

import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { describeAdminStatus } from "@/lib/admins/describe-admin-status";
import { AssignRoleControl } from "./assign-role-control";

type AdminRowProps = {
  readonly entry: AdminListEntry;
  readonly api: AdminsApi;
  readonly roles: readonly AdminRole[];
  readonly isOwnRow: boolean;
  readonly canWriteAdmins: boolean;
  readonly canWriteRoles: boolean;
  /** Runs an API call with the re-authentication prompt, then refetches; shows the API's refusal. */
  readonly onAct: (action: () => Promise<unknown>) => void;
  /** Resends the invitation and shows its new link once. */
  readonly onResend: (id: string) => void;
};

const CELL = "border-b border-rx-line px-2 py-1";

/** One row of the admin list; its controls follow the permissions (visibility only: the API enforces them). */
export function AdminRow({ entry, api, roles, isOwnRow, canWriteAdmins, canWriteRoles, onAct, onResend }: AdminRowProps) {
  const isInvited = entry.status === "invited";
  const button = (label: string, action: () => Promise<unknown>) => (
    <button key={label} type="button" aria-label={`${label} ${entry.email}`} onClick={() => onAct(action)} className="rounded-rx border border-rx-line px-2 py-1 text-sm">
      {label}
    </button>
  );
  return (
    <tr className="align-top">
      <td className={CELL}>{entry.name ?? "-"}</td>
      <td className={CELL}>{entry.email}</td>
      <td className={CELL}>{entry.role}</td>
      <td className={CELL}>{entry.mfa === "enrolled" ? "enrolled" : "not enrolled"}</td>
      <td className={CELL}>{entry.lastSignInAt ?? "never"}</td>
      <td className={CELL}>{describeAdminStatus(entry)}</td>
      <td className={`${CELL} flex flex-wrap gap-1`}>
        {canWriteAdmins && isInvited && (
          <button type="button" aria-label={`Resend ${entry.email}`} onClick={() => onResend(entry.id)} className="rounded-rx border border-rx-line px-2 py-1 text-sm">Resend</button>
        )}
        {canWriteAdmins && isInvited && button("Revoke", () => api.revokeInvitation(entry.id))}
        {canWriteAdmins && entry.status === "active" && button("Suspend", () => api.suspend(entry.id))}
        {canWriteAdmins && entry.status === "suspended" && button("Reactivate", () => api.reactivate(entry.id))}
        {canWriteAdmins && !isInvited && button("Reset MFA", () => api.resetMfa(entry.id))}
        {canWriteAdmins && !isInvited && button("Force password reset", () => api.forcePasswordReset(entry.id))}
        {canWriteRoles && !isInvited && !isOwnRow && (
          <AssignRoleControl email={entry.email} currentRole={entry.role} roles={roles} onAssign={(role) => onAct(() => api.assignRole(entry.id, role))} />
        )}
      </td>
    </tr>
  );
}
