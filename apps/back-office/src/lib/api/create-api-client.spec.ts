/** @jest-environment node */
import { createApiClient } from "./create-api-client";
import { SignedOutError } from "./signed-out-error";

type Call = { path: string; credentials: RequestCredentials | undefined };

/** A fake API: protected paths answer 401 until a refresh succeeded; `expire()` makes the access token expire again. */
function createFakeApi(options: { refreshStatus?: number; refreshThrows?: boolean; alwaysUnauthorized?: boolean } = {}) {
  const calls: Call[] = [];
  let accessValid = false;
  let refreshesInFlight = 0;
  let mostRefreshesInFlight = 0;
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input).replace("http://api.test", "");
    calls.push({ path, credentials: init?.credentials });
    const isRefresh = path === "/api/v1/admin/auth/refresh";
    if (isRefresh) mostRefreshesInFlight = Math.max(mostRefreshesInFlight, ++refreshesInFlight);
    await new Promise((resolve) => setTimeout(resolve, 5)); // both callers are in flight before any answer
    if (isRefresh) {
      refreshesInFlight -= 1;
      if (options.refreshThrows) throw new TypeError("network down");
      const status = options.refreshStatus ?? 200;
      if (status === 200) accessValid = true;
      return { status, ok: status >= 200 && status < 300 } as Response;
    }
    const status = accessValid && !options.alwaysUnauthorized ? 200 : 401;
    return { status, ok: status === 200 } as Response;
  };
  return {
    fakeFetch,
    calls,
    expire: () => {
      accessValid = false;
    },
    mostRefreshesInFlight: () => mostRefreshesInFlight,
    refreshCount: () => calls.filter((c) => c.path === "/api/v1/admin/auth/refresh").length,
  };
}

describe("createApiClient", () => {
  it("sends one refresh for two requests that expire together, and retries both", async () => {
    const api = createFakeApi();
    const onSignedOut = jest.fn();
    const client = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, onSignedOut });
    const [first, second] = await Promise.all([client.request("/api/v1/admin/a"), client.request("/api/v1/admin/b")]);
    expect(api.refreshCount()).toBe(1);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(api.calls.filter((c) => c.path === "/api/v1/admin/a")).toHaveLength(2);
    expect(api.calls.filter((c) => c.path === "/api/v1/admin/b")).toHaveLength(2);
    expect(api.calls.every((c) => c.credentials === "include")).toBe(true);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("is signed out, without a loop, when the refresh is refused", async () => {
    const api = createFakeApi({ refreshStatus: 401 });
    const onSignedOut = jest.fn();
    const client = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, onSignedOut });
    await expect(Promise.all([client.request("/api/v1/admin/a"), client.request("/api/v1/admin/b")])).rejects.toBeInstanceOf(SignedOutError);
    expect(api.refreshCount()).toBe(1);
    expect(api.calls).toHaveLength(3); // a, b, one refresh: no retry after a failed refresh
    expect(onSignedOut).toHaveBeenCalled();
  });

  it("is signed out when the refresh request fails on the network", async () => {
    const api = createFakeApi({ refreshThrows: true });
    const client = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch });
    await expect(client.request("/api/v1/admin/a")).rejects.toBeInstanceOf(SignedOutError);
    expect(api.refreshCount()).toBe(1);
  });

  it("is signed out after a second 401 for the same request, with one refresh only", async () => {
    const api = createFakeApi({ alwaysUnauthorized: true });
    const onSignedOut = jest.fn();
    const client = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, onSignedOut });
    await expect(client.request("/api/v1/admin/a")).rejects.toBeInstanceOf(SignedOutError);
    expect(api.refreshCount()).toBe(1);
    expect(api.calls).toHaveLength(3); // a, refresh, a again
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("allows a new refresh when the access token expires again after the shared one settled", async () => {
    const api = createFakeApi();
    const client = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch });
    await client.request("/api/v1/admin/a");
    expect(api.refreshCount()).toBe(1);
    api.expire();
    const again = await client.request("/api/v1/admin/a");
    expect(again.status).toBe(200);
    expect(api.refreshCount()).toBe(2);
  });

  it("allows a new refresh after a failed one settled", async () => {
    const api = createFakeApi({ refreshStatus: 401 });
    const client = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch });
    await expect(client.request("/api/v1/admin/a")).rejects.toBeInstanceOf(SignedOutError);
    await expect(client.request("/api/v1/admin/a")).rejects.toBeInstanceOf(SignedOutError);
    expect(api.refreshCount()).toBe(2);
  });

  it("keeps two tabs from refreshing at the same time (browser-wide lock), and both end up signed in", async () => {
    const api = createFakeApi();
    let queue: Promise<unknown> = Promise.resolve();
    const sharedLock = <T,>(task: () => Promise<T>): Promise<T> => {
      const turn = queue.then(task, task);
      queue = turn.catch(() => undefined);
      return turn;
    };
    const tabOne = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, runExclusive: sharedLock });
    const tabTwo = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, runExclusive: sharedLock });
    const [first, second] = await Promise.all([tabOne.request("/api/v1/admin/a"), tabTwo.request("/api/v1/admin/b")]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(api.mostRefreshesInFlight()).toBe(1);
  });

  it("without the lock two tabs do have two refreshes in flight (what the lock prevents)", async () => {
    const api = createFakeApi();
    const unlocked = <T,>(task: () => Promise<T>): Promise<T> => task();
    const tabOne = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, runExclusive: unlocked });
    const tabTwo = createApiClient({ baseUrl: "http://api.test", fetch: api.fakeFetch, runExclusive: unlocked });
    await Promise.all([tabOne.request("/api/v1/admin/a"), tabTwo.request("/api/v1/admin/b")]);
    expect(api.mostRefreshesInFlight()).toBe(2);
  });
});
