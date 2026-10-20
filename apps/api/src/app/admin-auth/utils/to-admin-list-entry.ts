import type { AdminListEntry } from "../types/admin-list-entry";

/** An admin as a row of the admin list (RX-95). */
export function toAdminListEntry(admin: {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: string;
  readonly totpEnrolledAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly suspendedAt: Date | null;
}): AdminListEntry {
  return {
    id: admin.id,
    status: admin.suspendedAt ? "suspended" : "active",
    name: admin.name,
    email: admin.email,
    role: admin.role,
    mfa: admin.totpEnrolledAt ? "enrolled" : "not_enrolled",
    lastSignInAt: admin.lastSignInAt,
    invitationExpiresAt: null,
  };
}
