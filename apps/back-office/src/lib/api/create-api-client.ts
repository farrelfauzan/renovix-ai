import type { ApiClient } from "./api-client";
import { runWithRefreshLock } from "./run-with-refresh-lock";
import { SignedOutError } from "./signed-out-error";

/** Global prefix `/api` + version `v1` + `admin/auth/refresh` (apps/api admin-auth controller). */
const REFRESH_PATH = "/api/v1/admin/auth/refresh";
const UNAUTHORIZED = 401;

export type ApiClientOptions = {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** Called every time a request ends as signed out; keep it idempotent. */
  readonly onSignedOut?: () => void;
  /** Runs a refresh while no other tab refreshes; defaults to the browser-wide Web Lock. */
  readonly runExclusive?: <T>(task: () => Promise<T>) => Promise<T>;
};

/**
 * The back-office API client. The session lives in the httpOnly cookies the API sets (rx_admin_access,
 * rx_admin_refresh); this code never reads a token, it only sends `credentials: "include"`. The browser adds
 * the Origin header the API checks on /admin routes (RX-156) by itself.
 *
 * The API answers 401 for an expired access token and rotates the refresh token with reuse detection: a
 * second refresh with the already-used token ENDS THE SESSION. So all requests that get a 401 at the same
 * time join ONE shared refresh, then each retries once. Other tabs are kept out by a browser-wide Web
 * Lock around the refresh (`runExclusive`), so two tabs never have a refresh in flight together. Sign-in is not sent through this client (a 401
 * there means wrong credentials, not an expired session).
 * The retry is safe because the 401 comes from the access check, before the route does any work. A request
 * body must be re-sendable (string, not a stream).
 */
export function createApiClient({ baseUrl, fetch: fetchImpl = (input, init) => fetch(input, init), onSignedOut, runExclusive = runWithRefreshLock }: ApiClientOptions): ApiClient {
  let refreshing: Promise<void> | undefined;
  const send = (path: string, init?: RequestInit): Promise<Response> => fetchImpl(`${baseUrl}${path}`, { ...init, credentials: "include" });
  const refresh = (): Promise<void> => {
    refreshing ??= runExclusive(() => send(REFRESH_PATH, { method: "POST" }))
      .then((res) => {
        if (!res.ok) throw new SignedOutError();
      })
      .catch(() => {
        throw new SignedOutError();
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  const signOut = (): never => {
    onSignedOut?.();
    throw new SignedOutError();
  };
  return {
    async request(path, init) {
      const first = await send(path, init);
      if (first.status !== UNAUTHORIZED) return first;
      await refresh().catch(signOut);
      const retried = await send(path, init);
      if (retried.status === UNAUTHORIZED) return signOut();
      return retried;
    },
  };
}
