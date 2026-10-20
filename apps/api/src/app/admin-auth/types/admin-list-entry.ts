/** One row of the admin list (RX-95): an admin, or a pending invitation (status "invited", id of the invitation). */
export type AdminListEntry = {
  readonly id: string;
  readonly status: "invited" | "active" | "suspended";
  readonly name: string | null;
  readonly email: string;
  readonly role: string;
  readonly mfa: "enrolled" | "not_enrolled";
  readonly lastSignInAt: Date | null;
  /** When the invitation link expires; null for an admin. */
  readonly invitationExpiresAt: Date | null;
};
