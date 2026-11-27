/**
 * A session of a user as `GET /admin/users/:id/sessions` answers (RNX-100): created, expires and the browser's user
 * agent (null when none was sent). The API never sends the token or the IP address.
 */
export type UserSession = {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
};
