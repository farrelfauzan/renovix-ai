import type { ApiClient } from "@/lib/api/api-client";
import { readRefusal } from "./read-refusal";
import type { SessionScope } from "./session-scope";
import type { SignInInput } from "./sign-in-input";
import type { TotpEnrolment } from "./totp-enrolment";

/** Global prefix `/api` + version `v1` + the admin auth controller (apps/api, RX-94). */
const AUTH_PATH = "/api/v1/admin/auth";

/** The sign-in and TOTP enrolment routes (RX-94). Each throws a RefusedError with the API's message on any answer but 2xx. */
export type SignInApi = {
  /** Sets the session cookies; the scope says whether the session is a full one or for TOTP enrolment only. */
  readonly signIn: (input: SignInInput) => Promise<SessionScope>;
  /** Enrolment session only: a new TOTP secret. */
  readonly enrolTotp: () => Promise<TotpEnrolment>;
  /** Enrolment session only: confirms with the first code; the recovery codes (shown once), the session becomes a full one. */
  readonly confirmTotp: (code: string) => Promise<readonly string[]>;
};

/**
 * The sign-in routes: `publicClient` sends the sign-in (a 401 there is wrong credentials, never refreshed),
 * `sessionClient` the enrolment routes on the enrolment session (cookies, shared refresh).
 */
export function createSignInApi(publicClient: ApiClient, sessionClient: ApiClient): SignInApi {
  const post = async <T,>(client: ApiClient, path: string, body?: object): Promise<T> => {
    const init: RequestInit = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" };
    const res = await client.request(`${AUTH_PATH}${path}`, init);
    if (!res.ok) throw await readRefusal(res);
    return res.json();
  };
  return {
    signIn: async (input) => (await post<{ scope: SessionScope }>(publicClient, "/sign-in", input)).scope,
    enrolTotp: () => post<TotpEnrolment>(sessionClient, "/totp/enrol"),
    confirmTotp: async (code) => (await post<{ recoveryCodes: string[] }>(sessionClient, "/totp/confirm", { code })).recoveryCodes,
  };
}
