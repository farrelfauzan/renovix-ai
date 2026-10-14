import type { IssuedAdminSession } from "./issued-admin-session";

/** A confirmed TOTP enrolment: the recovery codes (shown once) and the full session that replaces the enrolment one. */
export type EnrolmentResult = {
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedAdminSession;
};
