import type { AdminListEntry } from "./admin-list-entry";

/** The status text of a row: an invitation past its expiry is "invited, expired" (resend or revoke it). */
export function describeAdminStatus(entry: AdminListEntry, now: number = Date.now()): string {
  if (entry.status !== "invited") return entry.status;
  const isExpired = entry.invitationExpiresAt != null && Date.parse(entry.invitationExpiresAt) < now;
  return isExpired ? "invited, expired" : "invited";
}
