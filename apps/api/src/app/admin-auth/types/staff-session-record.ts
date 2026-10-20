/** A back-office session with its admin's role and the role's permissions, as read on every `staff` request (RX-96). */
export type StaffSessionRecord = {
  readonly id: string;
  readonly adminId: string;
  readonly scope: string;
  readonly revokedAt: Date | null;
  readonly absoluteExpiresAt: Date;
  readonly lastSeenAt: Date;
  readonly lastReauthAt: Date | null;
  /** RX-95: set when the admin is suspended; such a session is refused. */
  readonly suspendedAt: Date | null;
  readonly role: string;
  readonly permissions: readonly string[];
};
