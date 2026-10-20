/** The answer of an invitation create or resend: the raw link exists in this answer only (shown once, never stored). */
export type IssuedInvitation = {
  readonly invitation: { readonly id: string; readonly email: string; readonly role: string; readonly expiresAt: string };
  readonly link: string;
};
