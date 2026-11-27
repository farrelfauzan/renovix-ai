/**
 * A session of a user in the back office (RNX-100): when it was created, when it expires and the browser's user
 * agent (null when none was sent). Never the session token or the IP address.
 */
export type AdminUserSessionView = {
  readonly id: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
};
