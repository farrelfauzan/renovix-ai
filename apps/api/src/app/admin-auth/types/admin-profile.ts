/** The signed-in admin, for the back-office gate (RX-95, GET /admin/auth/me). */
export type AdminProfile = {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
  /** The session's scope: "enrolment", "password_change" or "full". */
  readonly scope: string;
  readonly mfaEnrolled: boolean;
  /** An Owner forced a password reset: only the change-password route is open until it is done. */
  readonly mustChangePassword: boolean;
};
