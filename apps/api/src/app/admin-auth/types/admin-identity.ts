/** The signed-in back-office admin that `AccessGuard` attaches to `request.admin` on a `staff` route. */
export type AdminIdentity = {
  readonly adminId: string;
  readonly sessionId: string;
  /**
   * "enrolment": TOTP not enrolled yet, only enrolment routes; "password_change": a forced password reset
   * (RX-95), only the change-password route; "full": every staff route.
   */
  readonly scope: string;
  /** The name of the admin's role (RX-96), as read on this request: "owner", "operations", ... or a custom role. */
  readonly role: string;
};
