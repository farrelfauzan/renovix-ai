/** @jest-environment node */
import { createApiClient } from "./create-api-client";
import { SignedOutError } from "./signed-out-error";

type Call = { path: string; credentials: RequestCredentials | undefined };

/** A fake API: protected paths answer 401 until a refresh succeeded; `expire()` makes the access token expire again. */
function createFakeApi(options: { refreshStatus?: number; refreshThrows?: boolean; alwaysUnauthorized?: boolean } = {}) {
  const calls: Call[] = [];
  let accessValid = false;
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input).replace("http://api.test", "");
    calls.push({ path, credentials: init?.credentials });
    await new Promise((resolve) => setTimeout(resolve, 5)); // both callers are in flight before any answer
    if (path === "/api/v1/admin/auth/refresh") {
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
});
