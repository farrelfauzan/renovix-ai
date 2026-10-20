import type { SessionScope } from "@/lib/sign-in/session-scope";

/** The answer of `GET /api/v1/admin/auth/me` (RX-95): the signed-in admin and what the session may do. */
export type AdminProfile = {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
  readonly scope: SessionScope;
  readonly mfaEnrolled: boolean;
  /** An Owner forced a password reset: only the change-password screen is open until it is done. */
  readonly mustChangePassword: boolean;
};
