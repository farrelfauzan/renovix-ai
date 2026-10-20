/** The body of `POST /api/v1/admin/invitations/accept` (RX-95): the link's token, the new admin's name and password. */
export type AcceptInvitationInput = {
  readonly token: string;
  readonly name: string;
  readonly password: string;
};
