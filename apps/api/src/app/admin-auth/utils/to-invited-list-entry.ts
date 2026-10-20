import type { AdminInvitationView } from "../types/admin-invitation-view";
import type { AdminListEntry } from "../types/admin-list-entry";

/** A pending invitation as a row of the admin list (RX-95): status "invited", no admin row yet. */
export function toInvitedListEntry(invitation: AdminInvitationView): AdminListEntry {
  return {
    id: invitation.id,
    status: "invited",
    name: null,
    email: invitation.email,
    role: invitation.role,
    mfa: "not_enrolled",
    lastSignInAt: null,
    invitationExpiresAt: invitation.expiresAt,
  };
}
