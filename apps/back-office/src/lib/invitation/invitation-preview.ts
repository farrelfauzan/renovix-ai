/**
 * The answer of `POST /api/v1/admin/invitations/preview` (RX-95): who is invited, with which role, by whom (with
 * their role name, RNX-333), when this link was sent (RNX-333) and when it expires.
 */
export type InvitationPreview = {
  readonly email: string;
  readonly role: string;
  readonly invitedBy: { readonly name: string | null; readonly email: string; readonly role: string };
  readonly expiresAt: string;
  readonly sentAt: string;
};
