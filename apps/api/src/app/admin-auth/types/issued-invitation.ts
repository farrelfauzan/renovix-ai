import type { AdminAuditChange } from "./admin-audit-change";
import type { AdminInvitationView } from "./admin-invitation-view";

/** A created or resent invitation (RX-95): the raw link, shown once to the inviting Owner, and the audit change. */
export type IssuedInvitation = {
  readonly invitation: AdminInvitationView;
  readonly link: string;
  readonly change: AdminAuditChange;
};
