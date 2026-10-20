/** What the invitation link's holder sees before completing it (RX-95). */
export type InvitationPreview = {
  readonly email: string;
  readonly role: string;
  readonly invitedBy: { readonly name: string | null; readonly email: string };
  readonly expiresAt: Date;
};
