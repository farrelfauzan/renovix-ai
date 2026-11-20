/**
 * RNX-78: one row of GET /auth/sessions. Never the session token or the IP address, and no location: the device is
 * read from the user agent, `lastActiveAt` is the session row's last update (Better Auth refreshes it at most once a
 * day, session.updateAge).
 */
export interface SessionView {
  readonly id: string;
  readonly device: string;
  readonly lastActiveAt: Date;
  /** True for the session that made this request. */
  readonly isCurrent: boolean;
}
