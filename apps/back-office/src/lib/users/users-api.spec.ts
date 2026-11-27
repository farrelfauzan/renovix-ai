import type { ApiClient } from "@/lib/api/api-client";
import { createUsersApi, type UsersApi } from "./users-api";

// RNX-358: the users routes as sent through the session client: paths, query parameters and the reveal body.

const okClient = (body: unknown) => {
  const request = jest.fn(async (_path: string, _init?: RequestInit): Promise<Response> => ({ ok: true, status: 200, json: async () => body }) as Response);
  return { request, api: createUsersApi({ request } as ApiClient) };
};

describe("createUsersApi (RNX-358)", () => {
  it("listUsers sends only the parameters that are set", async () => {
    const { request, api } = okClient({ page: 1, pageSize: 50, hasMore: false, items: [] });
    await api.listUsers({ email: "budi@example.com", id: undefined, status: "locked", page: 1 });
    expect(request).toHaveBeenCalledWith("/api/v1/admin/users?email=budi%40example.com&status=locked&page=1", { method: "GET" });
  });

  it("getUser reads the user by its encoded id", async () => {
    const { request, api } = okClient({});
    await api.getUser("user/7");
    expect(request).toHaveBeenCalledWith("/api/v1/admin/users/user%2F7", { method: "GET" });
  });

  it("revealField posts the field and the reason", async () => {
    const { request, api } = okClient({ field: "phone", value: null });
    expect(await api.revealField("user-7", { field: "phone", reason: "ticket 5120" })).toEqual({ field: "phone", value: null });
    expect(request).toHaveBeenCalledWith("/api/v1/admin/users/user-7/reveal", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ field: "phone", reason: "ticket 5120" }),
    });
  });

  it("RNX-100: listSessions reads the user's sessions by its encoded id", async () => {
    const { request, api } = okClient({ sessions: [] });
    expect(await api.listSessions("user/7")).toEqual({ sessions: [] });
    expect(request).toHaveBeenCalledWith("/api/v1/admin/users/user%2F7/sessions", { method: "GET" });
  });

  it.each([
    ["suspend", (api: UsersApi) => api.suspend("user-7", "r"), "/api/v1/admin/users/user-7/suspend", "POST"],
    ["reinstate", (api: UsersApi) => api.reinstate("user-7", "r"), "/api/v1/admin/users/user-7/reinstate", "POST"],
    ["resetApiKeys", (api: UsersApi) => api.resetApiKeys("user-7", "r"), "/api/v1/admin/users/user-7/reset-api-keys", "POST"],
    ["revokeSession", (api: UsersApi) => api.revokeSession("user-7", "session/1", "r"), "/api/v1/admin/users/user-7/sessions/session%2F1", "DELETE"],
    ["revokeAllSessions", (api: UsersApi) => api.revokeAllSessions("user-7", "r"), "/api/v1/admin/users/user-7/sessions", "DELETE"],
  ])("RNX-100: %s sends one request with the reason as its JSON body", async (_name, call, path, method) => {
    const { request, api } = okClient({ revoked: 2 });
    await call(api);
    expect(request.mock.calls).toEqual([[path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "r" }) }]]);
  });
});
