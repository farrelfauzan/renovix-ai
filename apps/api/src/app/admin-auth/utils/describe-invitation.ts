import type { AdminAuditValues } from "../types/admin-audit-values";

/** An invitation's audit values (RX-95): its id, email, role and expiry; never the token or its hash. */
export function describeInvitation(invitation: {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: Date;
}): AdminAuditValues {
  return { invitationId: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() };
}
