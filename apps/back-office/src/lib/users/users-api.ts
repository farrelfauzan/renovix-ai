import type { ApiClient } from "@/lib/api/api-client";
import { sendAdminRequest } from "@/lib/api/send-admin-request";
import type { UserDetail } from "./user-detail";
import type { UserListPage } from "./user-list-page";
import type { UserListQuery } from "./user-list-query";
import type { UserReveal } from "./user-reveal";
import type { UserRevealInput } from "./user-reveal-input";

/**
 * The back-office users routes (RNX-357). Each needs `users:read`; each throws SignedOutError when the session is
 * over and a RefusedError with the API's message otherwise.
 */
export type UsersApi = {
  /** One page of users (50); unset parameters are not sent. */
  readonly listUsers: (query: UserListQuery) => Promise<UserListPage>;
  /** One user, personal data masked. */
  readonly getUser: (id: string) => Promise<UserDetail>;
  /** Reveals one personal field (audited with the reason); needs `users:read_pii` or a per-case grant. */
  readonly revealField: (id: string, input: UserRevealInput) => Promise<UserReveal>;
};

/** The users routes on the session client (cookies, shared refresh). */
export function createUsersApi(client: ApiClient): UsersApi {
  const userPath = (id: string): string => `/users/${encodeURIComponent(id)}`;
  return {
    listUsers: async (query) => {
      const parameters = Object.entries(query).flatMap(([name, value]) => (value === undefined ? [] : [[name, String(value)]]));
      return (await sendAdminRequest(client, `/users?${new URLSearchParams(parameters)}`)).json();
    },
    getUser: async (id) => (await sendAdminRequest(client, userPath(id))).json(),
    revealField: async (id, input) => (await sendAdminRequest(client, `${userPath(id)}/reveal`, "POST", input)).json(),
  };
}
