import { ReauthRequiredError } from "@/lib/admins/reauth-required-error";
import { RefusedError } from "@/lib/sign-in/refused-error";
import { readRefusal } from "@/lib/sign-in/read-refusal";
import type { ApiClient } from "./api-client";

/** Global prefix `/api` + version `v1` + the admin routes. */
const ADMIN_PATH = "/api/v1/admin";
/** The message of the API's 403 for a sensitive action without a recent re-authentication. */
const REAUTH_MESSAGE = "Re-authentication required";
const FORBIDDEN = 403;

/**
 * Sends a request to an admin route and returns the answer when it is 2xx. Throws SignedOutError when the session
 * is over (the client), ReauthRequiredError for 403 "Re-authentication required", a RefusedError saying the admin
 * may not do this for any other 403, and a RefusedError with the API's message for any other refusal.
 */
export async function sendAdminRequest(client: ApiClient, path: string, method = "GET", body?: unknown): Promise<Response> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await client.request(`${ADMIN_PATH}${path}`, init);
  if (res.ok) return res;
  const refusal = await readRefusal(res);
  if (res.status !== FORBIDDEN) throw refusal;
  if (refusal.message === REAUTH_MESSAGE) throw new ReauthRequiredError(refusal.message, res.status);
  throw new RefusedError(`Your role does not allow this (the API answered: ${refusal.message}).`, res.status);
}
