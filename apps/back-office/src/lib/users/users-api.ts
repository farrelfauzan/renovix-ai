import type { ApiClient } from "@/lib/api/api-client";
import { sendAdminRequest } from "@/lib/api/send-admin-request";
import type { RevokedCount } from "./revoked-count";
import type { UserDetail } from "./user-detail";
import type { UserListPage } from "./user-list-page";
import type { UserListQuery } from "./user-list-query";
import type { UserReveal } from "./user-reveal";
import type { UserRevealInput } from "./user-reveal-input";
import type { UserSessionList } from "./user-session-list";

/**
 * The back-office users routes (RNX-357). The reads need `users:read`; RNX-100's writes need `users:write` and send
 * their reason (audited). Each throws SignedOutError when the session is over and a RefusedError with the API's
 * message otherwise.
 */
export type UsersApi = {
  /** One page of users (50); unset parameters are not sent. */
  readonly listUsers: (query: UserListQuery) => Promise<UserListPage>;
  /** One user, personal data masked. */
  readonly getUser: (id: string) => Promise<UserDetail>;
  /** Reveals one personal field (audited with the reason); needs `users:read_pii` or a per-case grant. */
  readonly revealField: (id: string, input: UserRevealInput) => Promise<UserReveal>;
  /** Suspends the user and ends their sessions (RNX-100). */
  readonly suspend: (id: string, reason: string) => Promise<void>;
  /** Lifts the user's suspension (RNX-100). */
  readonly reinstate: (id: string, reason: string) => Promise<void>;
  /** Revokes every API key of the user that is not revoked yet; answers how many (RNX-100). */
  readonly resetApiKeys: (id: string, reason: string) => Promise<RevokedCount>;
  /** The user's sessions, newest first (RNX-100). */
  readonly listSessions: (id: string) => Promise<UserSessionList>;
  /** Ends one session of the user (RNX-100). */
  readonly revokeSession: (id: string, sessionId: string, reason: string) => Promise<void>;
  /** Ends every session of the user; answers how many (RNX-100). */
  readonly revokeAllSessions: (id: string, reason: string) => Promise<RevokedCount>;
};

/** The users routes on the session client (cookies, shared refresh). */
export function createUsersApi(client: ApiClient): UsersApi {
  const userPath = (id: string): string => `/users/${encodeURIComponent(id)}`;
  const act = async (path: string, method: string, reason: string): Promise<void> => {
    await sendAdminRequest(client, path, method, { reason });
  };
  return {
    listUsers: async (query) => {
      const parameters = Object.entries(query).flatMap(([name, value]) => (value === undefined ? [] : [[name, String(value)]]));
      return (await sendAdminRequest(client, `/users?${new URLSearchParams(parameters)}`)).json();
    },
    getUser: async (id) => (await sendAdminRequest(client, userPath(id))).json(),
    revealField: async (id, input) => (await sendAdminRequest(client, `${userPath(id)}/reveal`, "POST", input)).json(),
    suspend: (id, reason) => act(`${userPath(id)}/suspend`, "POST", reason),
    reinstate: (id, reason) => act(`${userPath(id)}/reinstate`, "POST", reason),
    resetApiKeys: async (id, reason) => (await sendAdminRequest(client, `${userPath(id)}/reset-api-keys`, "POST", { reason })).json(),
    listSessions: async (id) => (await sendAdminRequest(client, `${userPath(id)}/sessions`)).json(),
    revokeSession: (id, sessionId, reason) => act(`${userPath(id)}/sessions/${encodeURIComponent(sessionId)}`, "DELETE", reason),
    revokeAllSessions: async (id, reason) => (await sendAdminRequest(client, `${userPath(id)}/sessions`, "DELETE", { reason })).json(),
  };
}
