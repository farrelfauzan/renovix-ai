/** The answer of `POST /api/v1/admin/invitations/preview` (RX-95): who is invited, with which role, and by whom. */
export type InvitationPreview = {
  readonly email: string;
  readonly role: string;
  readonly invitedBy: { readonly name: string | null; readonly email: string };
  readonly expiresAt: string;
};
