import type { AdminUserSessionView } from "./admin-user-session-view";

/** A user's sessions in the back office (RNX-100): the newest USER_SESSION_LIST_LIMIT, newest first. */
export type AdminUserSessionList = {
  readonly sessions: readonly AdminUserSessionView[];
};
