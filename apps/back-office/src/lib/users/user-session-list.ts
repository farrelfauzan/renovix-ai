import type { UserSession } from "./user-session";

/** A user's sessions, newest first (the API sends at most 50, RNX-100). */
export type UserSessionList = {
  readonly sessions: readonly UserSession[];
};
