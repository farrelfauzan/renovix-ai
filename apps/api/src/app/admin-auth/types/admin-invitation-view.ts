/** An invitation as the API shows it (RX-95): never the token or its hash. */
export type AdminInvitationView = {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly invitedByAdminId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
};
