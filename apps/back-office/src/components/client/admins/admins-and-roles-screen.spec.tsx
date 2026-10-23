import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createAdminsApi } from "@/lib/admins/admins-api";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { ApiClient } from "@/lib/api/api-client";
import { createApiClient } from "@/lib/api/create-api-client";
import { createPublicApiClient } from "@/lib/api/create-public-api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { AdminsAndRolesScreen } from "./admins-and-roles-screen";

// RNX-189: the admins and roles screen against a stateful fake of the API at the ApiClient boundary. The API's
// own rules (audit rows, last owner, direct calls without permission) are tested in apps/api; here the screen
// shows its answers. Obviously fake values only.

const SECRET_LINK = "https://bo.test/accept-invitation#token=SECRET-TOKEN-1";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
const OWNER_PERMISSIONS = ["admins:read", "admins:write", "roles:read", "roles:write"];

const admin = (id: string, overrides: Partial<AdminListEntry> = {}): AdminListEntry => ({
  id, status: "active", name: id, email: `${id}@example.com`, role: "support", mfa: "enrolled", lastSignInAt: "2026-10-20T08:00:00.000Z", ...overrides,
});
const role = (name: string, builtIn: boolean, permissions: string[] = ["users:read"]): AdminRole => ({ name, permissions, builtIn });
const profile = (permissions: string[], id = "owner"): AdminProfile => ({
  id, email: `${id}@example.com`, name: id, role: "owner", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true,
});

type FakeState = { admins: AdminListEntry[]; roles: AdminRole[]; isReauthed: boolean; counter: number };

/** A fake API: the lists, the writes, and the re-authentication window; `calls` is every "METHOD path". */
function createFakeApi(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    admins: [admin("owner", { role: "owner" }), admin("ops"), admin("owner2", { role: "owner" })],
    roles: [role("owner", true, OWNER_PERMISSIONS), role("support", true), role("custom_ro", false), role("held_role", false)],
    isReauthed: false,
    counter: 0,
    ...initial,
  };
  const calls: string[] = [];
  const reply = (status: number, body?: unknown): Response =>
    ({ ok: status < 400, status, json: async () => body }) as Response;
  const needsReauth = (): Response | null => (state.isReauthed ? null : reply(403, { message: "Re-authentication required" }));
  const find = (id: string) => state.admins.find((entry) => entry.id === id);
  const patch = (id: string, changes: Partial<AdminListEntry>) => {
    state.admins = state.admins.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry));
  };
  const activeOwners = () => state.admins.filter((entry) => entry.role === "owner" && entry.status === "active");
  const handle = (method: string, path: string, body: Record<string, any>): Response => {
    const [, , , , area, id, action] = path.split("/").map(decodeURIComponent);
    if (area === "admins" && !id) return reply(200, { admins: state.admins });
    if (area === "roles" && !id && method === "GET") return reply(200, { roles: state.roles });
    if (area === "auth") {
      if (body.password !== "pw" || body.totp !== "123456") return reply(401, { statusCode: 401, message: "Invalid credentials", error: "Unauthorized" });
      state.isReauthed = true;
      return reply(204);
    }
    if (area === "invitations" && !id) {
      if (state.admins.some((entry) => entry.email.toLowerCase() === body.email.toLowerCase())) {
        const pending = state.admins.find((entry) => entry.status === "invited" && entry.email === body.email);
        return reply(409, { message: pending ? "An invitation for this email is already pending" : "This email already belongs to an admin" });
      }
      state.counter += 1;
      state.admins = [...state.admins, admin(`inv-${state.counter}`, { status: "invited", name: null, email: body.email, role: body.role, mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: FUTURE })];
      return reply(201, { invitation: { id: `inv-${state.counter}`, email: body.email, role: body.role, expiresAt: FUTURE }, link: SECRET_LINK });
    }
    if (area === "invitations" && action === "resend") {
      patch(id, { invitationExpiresAt: FUTURE });
      return reply(200, { invitation: { id, email: find(id)?.email, role: find(id)?.role, expiresAt: FUTURE }, link: SECRET_LINK });
    }
    if (area === "invitations") {
      state.admins = state.admins.filter((entry) => entry.id !== id);
      return reply(204);
    }
    if (area === "admins" && action === "reactivate") return patch(id, { status: "active" }), reply(204);
    if (area === "admins") {
      const denied = needsReauth();
      if (denied) return denied;
      const target = find(id);
      const isLastOwner = target?.role === "owner" && activeOwners().length < 2;
      if (action === "suspend") {
        if (isLastOwner) return reply(409, { message: "The last active owner cannot be suspended" });
        return patch(id, { status: "suspended" }), reply(204);
      }
      if (action === "reset-mfa") return patch(id, { mfa: "not_enrolled" }), reply(204);
      if (action === "force-password-reset") return reply(204);
      if (action === "role") {
        if (isLastOwner && body.role !== "owner") return reply(409, { message: "The last active owner keeps the Owner role" });
        return patch(id, { role: body.role }), reply(204);
      }
    }
    if (area === "roles" && method === "POST") {
      if (state.roles.some((entry) => entry.name === body.name)) return reply(409, { message: "A role with this name already exists" });
      state.roles = [...state.roles, role(body.name, false, body.permissions)];
      return reply(204);
    }
    if (area === "roles" && method === "PATCH") {
      const denied = needsReauth();
      if (denied) return denied;
      state.roles = state.roles.map((entry) => (entry.name === id ? { ...entry, name: body.name ?? entry.name, permissions: body.permissions ?? entry.permissions } : entry));
      return reply(204);
    }
    if (area === "roles" && method === "DELETE") {
      if (state.roles.find((entry) => entry.name === id)?.builtIn) return reply(403, { message: "Built-in roles cannot be deleted" });
      if (id === "held_role") return reply(409, { message: "The role is held by an admin or an invitation" });
      state.roles = state.roles.filter((entry) => entry.name !== id);
      return reply(204);
    }
    return reply(404, { message: "Not found" });
  };
  const request = jest.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path.replace("/api/v1/admin", "")}`);
    return handle(method, path, init?.body ? JSON.parse(String(init.body)) : {});
  });
  const client: ApiClient = { request };
  return { state, calls, api: createAdminsApi(client, client), count: (call: string) => calls.filter((entry) => entry === call).length };
}

const sessionOf = (me: AdminProfile): SessionApi => ({ me: async () => me, changePassword: async () => undefined, signOut: async () => undefined });
const rowOf = (email: string): HTMLElement => screen.getByText(email).closest("tr") as HTMLElement;
const renderScreen = async (fake: ReturnType<typeof createFakeApi>, me = profile(OWNER_PERMISSIONS)) => {
  render(<AdminsAndRolesScreen api={fake.api} sessionApi={sessionOf(me)} />);
  await screen.findByRole("table", { name: "Admins" });
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const confirmIdentity = async (password = "pw", totp = "123456") => {
  const prompt = await screen.findByRole("dialog", { name: "Confirm it is you" });
  fireEvent.change(within(prompt).getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(within(prompt).getByLabelText("Authenticator code"), { target: { value: totp } });
  fireEvent.click(within(prompt).getByRole("button", { name: "Confirm" }));
};

describe("AdminsAndRolesScreen (RNX-189)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("lists name, email, role, MFA, last sign-in and status of every admin and invitation", async () => {
    const fake = createFakeApi();
    fake.state.admins.push(admin("late", { status: "invited", name: null, role: "support", mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: FUTURE }), admin("gone", { status: "suspended" }));

    await renderScreen(fake);

    const table = screen.getByRole("table", { name: "Admins" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Name", "Email", "Role", "MFA", "Last sign-in", "Status", "Actions"]);
    expect(within(rowOf("late@example.com")).getAllByRole("cell").slice(0, 6).map((cell) => cell.textContent)).toEqual(["-", "late@example.com", "support", "not enrolled", "never", "invited"]);
    expect(within(rowOf("gone@example.com")).getAllByRole("cell")[5].textContent).toBe("suspended");
    expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("active");
  });

  describe("criterion 1: after the API answers the list is fetched again and shows the new state", () => {
    it("suspend, reactivate, reset MFA, assign a role and invite", async () => {
      const fake = createFakeApi({ isReauthed: true });
      await renderScreen(fake);
      expect(fake.count("GET /admins")).toBe(1);

      click("Suspend ops@example.com");
      await waitFor(() => expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("suspended"));
      click("Reactivate ops@example.com");
      await waitFor(() => expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("active"));
      click("Reset MFA ops@example.com");
      await waitFor(() => expect(within(rowOf("ops@example.com")).getAllByRole("cell")[3].textContent).toBe("not enrolled"));
      fireEvent.change(screen.getByLabelText("Role for ops@example.com"), { target: { value: "custom_ro" } });
      click("Assign role to ops@example.com");
      await waitFor(() => expect(within(rowOf("ops@example.com")).getAllByRole("cell")[2].textContent).toBe("custom_ro"));
      click("Force password reset ops@example.com");
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
      await waitFor(() => expect(within(rowOf("new@example.com")).getAllByRole("cell")[5].textContent).toBe("invited"));

      expect(fake.calls).toEqual(expect.arrayContaining(["POST /admins/ops/suspend", "POST /admins/ops/reactivate", "POST /admins/ops/reset-mfa", "PUT /admins/ops/role", "POST /admins/ops/force-password-reset", "POST /invitations"]));
      await waitFor(() => expect(fake.count("GET /admins")).toBe(7));
    });
  });

  describe("criterion 2: the invitation link is shown once and kept nowhere", () => {
    it("shows the link with the single-use note, then it is gone after closing: not in storage, URL or a re-opened dialog", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });

      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

      const dialog = await screen.findByRole("dialog", { name: "Invitation created" });
      expect((within(dialog).getByLabelText("Invitation link") as HTMLInputElement).value).toBe(SECRET_LINK);
      expect(dialog.textContent).toContain("shown only this time");
      click("Close");
      expect(screen.queryByRole("dialog", { name: "Invitation created" })).toBeNull();
      expect(document.body.innerHTML).not.toContain("SECRET-TOKEN-1");
      const stored = [localStorage, sessionStorage].map((area) => JSON.stringify({ ...area }));
      expect(stored.join("")).not.toContain("SECRET-TOKEN-1");
      expect(document.cookie).not.toContain("SECRET-TOKEN-1");
      expect(window.location.href).not.toContain("SECRET-TOKEN-1");
      expect(window.location.hash).toBe("");
      click("Invite admin");
      expect(screen.queryByLabelText("Invitation link")).toBeNull();
      expect(document.body.innerHTML).not.toContain("SECRET-TOKEN-1");
    });

    it("a resend shows the new link once too", async () => {
      const fake = createFakeApi();
      fake.state.admins.push(admin("late", { status: "invited", invitationExpiresAt: FUTURE }));
      await renderScreen(fake);

      click("Resend late@example.com");

      expect((await screen.findByLabelText("Invitation link") as HTMLInputElement).value).toBe(SECRET_LINK);
      click("Close");
      expect(screen.queryByLabelText("Invitation link")).toBeNull();
      expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain("SECRET-TOKEN-1");
    });
  });

  describe("criterion 3: an expired invitation", () => {
    const expired = () => {
      const fake = createFakeApi();
      fake.state.admins.push(admin("late", { status: "invited", name: null, mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: PAST }));
      return fake;
    };

    it("is listed as invited, expired, with resend and revoke", async () => {
      await renderScreen(expired());

      const row = rowOf("late@example.com");

      expect(within(row).getAllByRole("cell")[5].textContent).toBe("invited, expired");
      expect(within(row).getByRole("button", { name: "Resend late@example.com" })).toBeTruthy();
      expect(within(row).getByRole("button", { name: "Revoke late@example.com" })).toBeTruthy();
      click("Revoke late@example.com");
      await waitFor(() => expect(screen.queryByText("late@example.com")).toBeNull());
    });

    it("inviting the same email shows the API's 409 message and offers that invitation's resend and revoke", async () => {
      const fake = expired();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "late@example.com" } });

      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

      const dialog = await screen.findByRole("dialog", { name: "Invite an admin" });
      expect((await within(dialog).findByRole("alert")).textContent).toBe("An invitation for this email is already pending");
      expect(within(dialog).getByRole("button", { name: "Revoke invitation" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Resend invitation" }));
      expect((await screen.findByLabelText("Invitation link") as HTMLInputElement).value).toBe(SECRET_LINK);
      expect(fake.calls).toContain("POST /invitations/late/resend");
      expect(screen.queryByRole("dialog", { name: "Invite an admin" })).toBeNull();
    });
  });

  describe("criterion 4: sensitive actions ask for a fresh password and TOTP", () => {
    it("sends the action, is refused, asks, sends reauth, then retries the action once", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);

      click("Suspend ops@example.com");
      const prompt = await screen.findByRole("dialog", { name: "Confirm it is you" });
      expect(within(prompt).getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
      expect(within(prompt).getByLabelText("Authenticator code").getAttribute("autocomplete")).toBe("one-time-code");
      expect(fake.calls.filter((call) => call.includes("suspend"))).toEqual(["POST /admins/ops/suspend"]);
      await confirmIdentity();

      await waitFor(() => expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("suspended"));
      expect(fake.calls.filter((call) => call.includes("suspend") || call.includes("reauth"))).toEqual(["POST /admins/ops/suspend", "POST /auth/reauth", "POST /admins/ops/suspend"]);
      expect(screen.queryByRole("dialog", { name: "Confirm it is you" })).toBeNull();
    });

    it("a wrong code shows the API's refusal and nothing changes; the right one then works", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Suspend ops@example.com");

      await confirmIdentity("pw", "000000");

      expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
      expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("active");
      expect(fake.count("POST /admins/ops/suspend")).toBe(1);
      expect(fake.state.admins.find((entry) => entry.id === "ops")?.status).toBe("active");
      await confirmIdentity();
      await waitFor(() => expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("suspended"));
    });

    it("with the real clients, a wrong code shows the API's 401: no refresh, no second reauth, no sign-out, nothing changes", async () => {
      const BASE = "http://api.test";
      const calls: string[] = [];
      const onSignedOut = jest.fn();
      const reply = (status: number, body?: unknown): Response => ({ ok: status < 400, status, json: async () => body }) as Response;
      const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const call = `${init?.method ?? "GET"} ${String(input).replace(`${BASE}/api/v1`, "")}`;
        calls.push(call);
        if (call === "GET /admin/admins") return reply(200, { admins: [admin("owner", { role: "owner" }), admin("ops")] });
        if (call === "GET /admin/roles") return reply(200, { roles: [role("owner", true, OWNER_PERMISSIONS), role("support", true)] });
        if (call === "POST /admin/admins/ops/suspend") return reply(403, { statusCode: 403, message: "Re-authentication required", error: "Forbidden" });
        if (call === "POST /admin/auth/reauth") return reply(401, { statusCode: 401, message: "Invalid credentials", error: "Unauthorized" });
        if (call === "POST /admin/auth/refresh") return reply(200, { scope: "full" });
        return reply(404, { message: "Not found" });
      });
      const api = createAdminsApi(
        createApiClient({ baseUrl: BASE, fetch: fetchMock, onSignedOut, runExclusive: (task) => task() }),
        createPublicApiClient({ baseUrl: BASE, fetch: fetchMock }),
      );
      render(<AdminsAndRolesScreen api={api} sessionApi={sessionOf(profile(OWNER_PERMISSIONS))} />);
      await screen.findByRole("table", { name: "Admins" });
      click("Suspend ops@example.com");

      await confirmIdentity("pw", "000000");

      expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
      expect(screen.getByRole("dialog", { name: "Confirm it is you" })).toBeTruthy();
      expect(calls.filter((call) => call === "POST /admin/auth/reauth")).toHaveLength(1);
      expect(calls).not.toContain("POST /admin/auth/refresh");
      expect(onSignedOut).not.toHaveBeenCalled();
      expect(calls.filter((call) => call === "POST /admin/admins/ops/suspend")).toHaveLength(1);
    });

    it("cancelling the prompt leaves everything unchanged", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Suspend ops@example.com");
      await screen.findByRole("dialog", { name: "Confirm it is you" });

      click("Cancel");

      expect((await screen.findByRole("alert")).textContent).toBe("Re-authentication was cancelled.");
      expect(fake.count("POST /admins/ops/suspend")).toBe(1);
      expect(fake.count("POST /auth/reauth")).toBe(0);
      expect(within(rowOf("ops@example.com")).getAllByRole("cell")[5].textContent).toBe("active");
    });
  });

  describe("criterion 5: controls follow the permissions", () => {
    it("without admins:write and roles:write no write control is shown", async () => {
      const fake = createFakeApi();
      fake.state.admins.push(admin("late", { status: "invited", invitationExpiresAt: PAST }));
      await renderScreen(fake, profile(["admins:read", "roles:read"], "ops"));

      expect(screen.queryByRole("button", { name: /Invite admin|Create role/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Suspend|Reactivate|Reset MFA|Force password|Resend|Revoke|Assign|Edit role|Delete role/ })).toBeNull();
      expect(screen.queryAllByRole("combobox")).toEqual([]);
      expect(screen.getByRole("table", { name: "Roles" })).toBeTruthy();
    });

    it("with roles:write but not admins:write: role assignment and role writes, no admin actions", async () => {
      await renderScreen(createFakeApi(), profile(["admins:read", "roles:read", "roles:write"], "mgr"));

      expect(screen.getByRole("button", { name: "Assign role to ops@example.com" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Create role" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Invite admin|Suspend|Reset MFA|Force password/ })).toBeNull();
    });

    it("without admins:read the admin list is not shown, without roles:read the roles are not", async () => {
      const fake = createFakeApi();
      await renderScreen(fake, profile(["admins:read"], "ops"));

      expect(screen.queryByRole("table", { name: "Roles" })).toBeNull();
      expect(fake.calls).toEqual(["GET /admins"]);
    });

    it("the signed-in admin's own row has no assign control (others do)", async () => {
      await renderScreen(createFakeApi());

      expect(within(rowOf("owner@example.com")).queryByRole("combobox")).toBeNull();
      expect(within(rowOf("ops@example.com")).getByRole("combobox")).toBeTruthy();
    });
  });

  describe("criterion 6: the API's refusals are shown and nothing changes", () => {
    it("the last active owner cannot be suspended", async () => {
      const fake = createFakeApi({ isReauthed: true });
      fake.state.admins = [admin("owner", { role: "owner" }), admin("owner2", { role: "owner" }), admin("ops", { status: "suspended" })];
      fake.state.admins[1] = { ...fake.state.admins[1], status: "suspended" };
      await renderScreen(fake, profile(OWNER_PERMISSIONS, "ops"));

      click("Suspend owner@example.com");

      expect((await screen.findByRole("alert")).textContent).toBe("The last active owner cannot be suspended");
      expect(within(rowOf("owner@example.com")).getAllByRole("cell")[5].textContent).toBe("active");
    });

    it("taking the Owner role from the last active owner", async () => {
      const fake = createFakeApi({ isReauthed: true });
      fake.state.admins = [admin("owner", { role: "owner" }), admin("ops")];
      await renderScreen(fake, profile(OWNER_PERMISSIONS, "ops"));
      fireEvent.change(screen.getByLabelText("Role for owner@example.com"), { target: { value: "support" } });

      click("Assign role to owner@example.com");

      expect((await screen.findByRole("alert")).textContent).toBe("The last active owner keeps the Owner role");
      expect(within(rowOf("owner@example.com")).getAllByRole("cell")[2].textContent).toBe("owner");
    });

    it("a role name that is taken keeps the form open with the API's message; a 400 shows its status text", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Create role");
      const form = screen.getByRole("dialog", { name: "Create a role" });
      fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "custom_ro" } });

      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));

      expect((await within(form).findByRole("alert")).textContent).toBe("A role with this name already exists");
      expect(fake.state.roles.filter((entry) => entry.name === "custom_ro")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Create a role" })).toBeTruthy();
    });

    it("an API refusal without a text message (e.g. a 400 with field errors) shows the status", async () => {
      const refusing: ApiClient = { request: async () => ({ ok: false, status: 400, json: async () => ({ permissions: ["bad"] }) }) as Response };
      const api = createAdminsApi(refusing, refusing);

      await expect(api.createRole({ name: "x", permissions: ["bad"] })).rejects.toThrow("The request was refused (400).");
    });
  });

  describe("roles: create and edit", () => {
    it("creates a custom role from the permission list (no Owner-only permission offered) and shows it", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Create role");
      const form = screen.getByRole("dialog", { name: "Create a role" });
      expect(within(form).queryByLabelText("admins:write")).toBeNull();
      expect(within(form).queryByLabelText("roles:write")).toBeNull();
      fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "finance_ro" } });
      fireEvent.click(within(form).getByLabelText("credits:read"));
      fireEvent.click(within(form).getByLabelText("usage:read"));

      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));

      await waitFor(() => expect(within(screen.getByRole("table", { name: "Roles" })).getByText("credits:read, usage:read")).toBeTruthy());
      expect(fake.state.roles.at(-1)).toMatchObject({ name: "finance_ro", permissions: ["credits:read", "usage:read"] });
      expect(screen.queryByRole("dialog", { name: "Create a role" })).toBeNull();
    });

    it("offers profit:read and reconciliation:write and sends them with a custom role (RNX-269)", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Create role");
      const form = screen.getByRole("dialog", { name: "Create a role" });
      fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "profit_viewer" } });
      fireEvent.click(within(form).getByLabelText("profit:read"));
      fireEvent.click(within(form).getByLabelText("reconciliation:write"));

      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create a role" })).toBeNull());
      expect(fake.state.roles.at(-1)).toMatchObject({ name: "profit_viewer", permissions: ["profit:read", "reconciliation:write"] });
    });

    it("edits a custom role after re-authentication, sending only what changed", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Edit role custom_ro");
      const form = screen.getByRole("dialog", { name: "Edit role custom_ro" });
      fireEvent.click(within(form).getByLabelText("usage:read"));
      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));

      await confirmIdentity();

      await waitFor(() => expect(within(screen.getByRole("table", { name: "Roles" })).getByText("users:read, usage:read")).toBeTruthy());
      expect(fake.calls.filter((call) => call.includes("custom_ro"))).toEqual(["PATCH /roles/custom_ro", "PATCH /roles/custom_ro"]);
    });
  });

  describe("criterion 7: deleting a custom role", () => {
    it("a role nobody holds leaves the list", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);

      click("Delete role custom_ro");

      await waitFor(() => expect(within(screen.getByRole("table", { name: "Roles" })).queryByText("custom_ro")).toBeNull());
      expect(fake.calls).toContain("DELETE /roles/custom_ro");
    });

    it("a held role shows the API's 409 and stays", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);

      click("Delete role held_role");

      expect((await screen.findByRole("alert")).textContent).toBe("The role is held by an admin or an invitation");
      expect(within(screen.getByRole("table", { name: "Roles" })).getByText("held_role")).toBeTruthy();
    });

    it("built-in roles have no edit or delete control", async () => {
      await renderScreen(createFakeApi());

      const roles = within(screen.getByRole("table", { name: "Roles" }));

      expect(roles.getAllByText("built-in", { selector: "td" })).toHaveLength(2);
      expect(roles.queryByRole("button", { name: /(Edit|Delete) role (owner|support)/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete role custom_ro" })).toBeTruthy();
    });
  });
});
