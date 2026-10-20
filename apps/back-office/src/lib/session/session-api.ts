import type { ApiClient } from "@/lib/api/api-client";
import { readRefusal } from "@/lib/sign-in/read-refusal";
import type { AdminProfile } from "./admin-profile";

/** Global prefix `/api` + version `v1` + the admin auth controller (apps/api, RX-94, RX-95). */
const AUTH_PATH = "/api/v1/admin/auth";

/**
 * The routes of the current admin session. Each throws SignedOutError when the session is over (the client's
 * refresh failed), and a RefusedError with the API's message on any other answer but 2xx.
 */
export type SessionApi = {
  /** The signed-in admin; works on every session scope. */
  readonly me: () => Promise<AdminProfile>;
  /** Password-change session only: sets the new password; the API starts a full session. */
  readonly changePassword: (newPassword: string) => Promise<void>;
  /** Ends the session (any scope) and clears the cookies. */
  readonly signOut: () => Promise<void>;
};

/** The session routes on the session client (cookies, shared refresh). */
export function createSessionApi(sessionClient: ApiClient): SessionApi {
  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    const res = await sessionClient.request(`${AUTH_PATH}${path}`, init);
    if (!res.ok) throw await readRefusal(res);
    return res;
  };
  return {
    me: async () => (await send("/me")).json(),
    changePassword: async (newPassword) => {
      await send("/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword }) });
    },
    signOut: async () => {
      await send("/sign-out", { method: "POST" });
    },
  };
}
