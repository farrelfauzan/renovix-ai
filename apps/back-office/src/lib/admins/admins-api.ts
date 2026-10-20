import type { ApiClient } from "@/lib/api/api-client";
import { readRefusal } from "@/lib/sign-in/read-refusal";
import type { AdminListEntry } from "./admin-list-entry";
import type { AdminRole } from "./admin-role";
import type { IssuedInvitation } from "./issued-invitation";
import type { ReauthCredentials } from "./reauth-credentials";
import { ReauthRequiredError } from "./reauth-required-error";
import type { RoleInput } from "./role-input";

/** Global prefix `/api` + version `v1` + the admin routes (apps/api admin-auth module: RX-95, RNX-187). */
const ADMIN_PATH = "/api/v1/admin";
/** The message of the API's 403 for a sensitive action without a recent re-authentication. */
const REAUTH_MESSAGE = "Re-authentication required";
const FORBIDDEN = 403;

/**
 * The admin, invitation and role routes. Each throws SignedOutError when the session is over, a
 * ReauthRequiredError for 403 "Re-authentication required", and a RefusedError with the API's message on any
 * other answer but 2xx.
 */
export type AdminsApi = {
  readonly listAdmins: () => Promise<readonly AdminListEntry[]>;
  readonly invite: (email: string, role: string) => Promise<IssuedInvitation>;
  readonly resendInvitation: (id: string) => Promise<IssuedInvitation>;
  readonly revokeInvitation: (id: string) => Promise<void>;
  readonly suspend: (id: string) => Promise<void>;
  readonly reactivate: (id: string) => Promise<void>;
  readonly resetMfa: (id: string) => Promise<void>;
  readonly forcePasswordReset: (id: string) => Promise<void>;
  readonly assignRole: (id: string, role: string) => Promise<void>;
  readonly listRoles: () => Promise<readonly AdminRole[]>;
  readonly createRole: (input: RoleInput) => Promise<void>;
  /** Only the changed fields are sent (a rename, new permissions, or both). */
  readonly updateRole: (name: string, changes: Partial<RoleInput>) => Promise<void>;
  readonly deleteRole: (name: string) => Promise<void>;
  /** Password and TOTP again; the API accepts the sensitive actions for two minutes after it. */
  readonly reauth: (credentials: ReauthCredentials) => Promise<void>;
};

/**
 * The admin routes on the session client (cookies, shared refresh). The re-authentication goes through
 * `reauthClient`, a client without the shared refresh: the API answers a wrong password or code with 401, which
 * the session client would take for an expired session (refresh, send it again, sign out) instead of showing it.
 */
export function createAdminsApi(client: ApiClient, reauthClient: ApiClient): AdminsApi {
  const send = async (path: string, method = "GET", body?: unknown, target: ApiClient = client): Promise<Response> => {
    const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await target.request(`${ADMIN_PATH}${path}`, init);
    if (res.ok) return res;
    const refusal = await readRefusal(res);
    throw res.status === FORBIDDEN && refusal.message === REAUTH_MESSAGE ? new ReauthRequiredError(refusal.message, res.status) : refusal;
  };
  const act = async (path: string, method = "POST", body?: unknown): Promise<void> => {
    await send(path, method, body);
  };
  const adminPath = (id: string, action: string): string => `/admins/${encodeURIComponent(id)}/${action}`;
  const rolePath = (name: string): string => `/roles/${encodeURIComponent(name)}`;
  return {
    listAdmins: async () => (await (await send("/admins")).json()).admins,
    invite: async (email, role) => (await send("/invitations", "POST", { email, role })).json(),
    resendInvitation: async (id) => (await send(`/invitations/${encodeURIComponent(id)}/resend`, "POST")).json(),
    revokeInvitation: (id) => act(`/invitations/${encodeURIComponent(id)}`, "DELETE"),
    suspend: (id) => act(adminPath(id, "suspend")),
    reactivate: (id) => act(adminPath(id, "reactivate")),
    resetMfa: (id) => act(adminPath(id, "reset-mfa")),
    forcePasswordReset: (id) => act(adminPath(id, "force-password-reset")),
    assignRole: (id, role) => act(adminPath(id, "role"), "PUT", { role }),
    listRoles: async () => (await (await send("/roles")).json()).roles,
    createRole: (input) => act("/roles", "POST", input),
    updateRole: (name, changes) => act(rolePath(name), "PATCH", changes),
    deleteRole: (name) => act(rolePath(name), "DELETE"),
    reauth: async (credentials) => {
      await send("/auth/reauth", "POST", credentials, reauthClient);
    },
  };
}
