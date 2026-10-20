import type { ApiClient } from "./api-client";

/**
 * A back-office API client WITHOUT the shared refresh, for the sign-in route only: there a 401 means wrong
 * credentials, not an expired session. It still sends `credentials: "include"` so the browser keeps the
 * session cookies the API sets in its answer.
 */
export function createPublicApiClient({ baseUrl, fetch: fetchImpl = (input, init) => fetch(input, init) }: { baseUrl: string; fetch?: typeof fetch }): ApiClient {
  return { request: (path, init) => fetchImpl(`${baseUrl}${path}`, { ...init, credentials: "include" }) };
}
