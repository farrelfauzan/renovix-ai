/** The signed-in back-office admin that `AccessGuard` attaches to `request.admin` on a `staff` route. */
export type AdminIdentity = {
  readonly adminId: string;
  readonly sessionId: string;
  /** "enrolment": TOTP not enrolled yet, only enrolment routes; "full": every staff route. */
  readonly scope: string;
  /** "owner" | "admin". */
  readonly role: string;
};
