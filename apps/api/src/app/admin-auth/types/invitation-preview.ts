/**
 * What the invitation link's holder sees before completing it (RX-95): the email and role invited, who invited
 * (with their role name, RNX-333), when this link was sent (created or resent, RNX-333) and when it expires.
 */
export type InvitationPreview = {
  readonly email: string;
  readonly role: string;
  readonly invitedBy: { readonly name: string | null; readonly email: string; readonly role: string };
  readonly expiresAt: Date;
  readonly sentAt: Date;
};
