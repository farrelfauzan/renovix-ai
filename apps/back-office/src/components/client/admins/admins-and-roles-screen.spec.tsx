import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createAdminsApi } from "@/lib/admins/admins-api";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { ApiClient } from "@/lib/api/api-client";
import { createApiClient } from "@/lib/api/create-api-client";
import { createPublicApiClient } from "@/lib/api/create-public-api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { pickOption } from "@/test/pick-option";
import { AdminDetailScreen } from "./admin-detail-screen";
import { AdminsAndRolesScreen } from "./admins-and-roles-screen";

// RNX-189: the admins and roles screen against a stateful fake of the API at the ApiClient boundary. The API's
// own rules (audit rows, last owner, direct calls without permission) are tested in apps/api; here the screen
// shows its answers. Obviously fake values only. Since RNX-373 (D443) every admin write lives on the admin's own page
// (AdminDetailScreen), so the tests of those writes render that page against the same fake. Since RNX-370 every write
// carries a reason: the fake refuses a write without one (400), and reactivate and role create and delete need a
// recent re-authentication, as in the API.

const SECRET_LINK = "https://bo.test/accept-invitation#token=SECRET-TOKEN-1";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
const OWNER_PERMISSIONS = ["admins:read", "admins:write", "roles:read", "roles:write"];
const REASON = "Made-up reason for an RNX-370 test";
const REASON_LABEL = "Reason (required, audited)";

const admin = (id: string, overrides: Partial<AdminListEntry> = {}): AdminListEntry => ({
  id, status: "active", name: id, email: `${id}@example.com`, role: "support", mfa: "enrolled", lastSignInAt: "2026-10-20T08:00:00.000Z", ...overrides,
});
const role = (name: string, builtIn: boolean, permissions: string[] = ["users:read"]): AdminRole => ({ name, permissions, builtIn });
const profile = (permissions: string[], id = "owner"): AdminProfile => ({
  id, email: `${id}@example.com`, name: id, role: "owner", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z",
});

type FakeState = { admins: AdminListEntry[]; roles: AdminRole[]; isReauthed: boolean; counter: number };

/** A fake API: the lists, the writes, and the re-authentication window; `calls` is every "METHOD path", `sent` each with its body. */
function createFakeApi(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    admins: [admin("owner", { role: "owner" }), admin("ops"), admin("owner2", { role: "owner" })],
    roles: [role("owner", true, OWNER_PERMISSIONS), role("support", true), role("custom_ro", false), role("held_role", false)],
    isReauthed: false,
    counter: 0,
    ...initial,
  };
  const calls: string[] = [];
  const sent: { readonly call: string; readonly body: Record<string, any> }[] = [];
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
    const isWrite = method !== "GET" && area !== "auth";
    if (isWrite && (typeof body.reason !== "string" || body.reason.trim() === "")) return reply(400, { message: "Invalid request body" });
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
    if (area === "admins") {
      const denied = needsReauth();
      if (denied) return denied;
      if (action === "reactivate") return patch(id, { status: "active" }), reply(204);
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
      const denied = needsReauth();
      if (denied) return denied;
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
      const denied = needsReauth();
      if (denied) return denied;
      if (state.roles.find((entry) => entry.name === id)?.builtIn) return reply(403, { message: "Built-in roles cannot be deleted" });
      if (id === "held_role") return reply(409, { message: "The role is held by an admin or an invitation" });
      state.roles = state.roles.filter((entry) => entry.name !== id);
      return reply(204);
    }
    return reply(404, { message: "Not found" });
  };
  const request = jest.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const call = `${method} ${path.replace("/api/v1/admin", "")}`;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(call);
    sent.push({ call, body });
    return handle(method, path, body);
  });
  const client: ApiClient = { request };
  /** The reason of each request sent as `call`, in order. */
  const reasonsOf = (call: string) => sent.filter((entry) => entry.call === call).map((entry) => entry.body.reason);
  return { state, calls, sent, reasonsOf, api: createAdminsApi(client, client), count: (call: string) => calls.filter((entry) => entry === call).length };
}

const sessionOf = (me: AdminProfile): SessionApi => ({ me: async () => me, changePassword: async () => undefined, signOut: async () => undefined });
const rowOf = (email: string): HTMLElement => within(screen.getByRole("table", { name: "Admins" })).getByText(email).closest("tr") as HTMLElement;
const renderScreen = async (fake: ReturnType<typeof createFakeApi>, me = profile(OWNER_PERMISSIONS)) => {
  render(<AdminsAndRolesScreen api={fake.api} sessionApi={sessionOf(me)} />);
  await screen.findByRole("table", { name: "Admins" });
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** Renders the page of the admin or invitation with this id and returns its detail once loaded. */
const renderDetail = async (fake: ReturnType<typeof createFakeApi>, id: string, me = profile(OWNER_PERMISSIONS)): Promise<HTMLElement> => {
  render(<AdminDetailScreen adminId={id} api={fake.api} sessionApi={sessionOf(me)} />);
  return screen.findByRole("region", { name: `Admin ${id}@example.com` });
};
/** The value the detail shows for a term, e.g. "Status". */
const field = (term: string): string | null | undefined => screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
// The role and provider pickers are the shared Select (Radix, RNX-291): open the trigger, then click the option.
// jsdom has no scrollIntoView, which the open list calls on its selected item, and no ResizeObserver, which the
// shared Checkbox of the role form uses to size its hidden form input.
Element.prototype.scrollIntoView = jest.fn();
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
/** Types the reason into the open reason dialog titled `title` and confirms it (RNX-370). */
const giveReason = async (title: string, reason = REASON) => {
  const dialog = await screen.findByRole("dialog", { name: title });
  fireEvent.change(within(dialog).getByLabelText(REASON_LABEL), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
};
/** The writes sent so far (every request but a GET and the re-authentication). */
const writesOf = (fake: ReturnType<typeof createFakeApi>) => fake.calls.filter((call) => !call.startsWith("GET") && call !== "POST /auth/reauth");
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
      await renderDetail(fake, "ops");
      expect(fake.count("GET /admins")).toBe(1);

      click("Suspend / remove access");
      await giveReason("Suspend ops@example.com");
      await waitFor(() => expect(field("Status")).toBe("suspended"));
      click("Reactivate");
      await giveReason("Reactivate ops@example.com");
      await waitFor(() => expect(field("Status")).toBe("active"));
      click("Reset MFA");
      await giveReason("Reset the MFA of ops@example.com");
      await waitFor(() => expect(field("MFA")).toBe("not enrolled"));
      pickOption(screen.getByLabelText("Role for ops@example.com"), "custom_ro");
      click("Save role for ops@example.com");
      await giveReason("Change the role of ops@example.com to custom_ro");
      await waitFor(() => expect(field("Role")).toBe("custom_ro"));
      click("Force password reset");
      await giveReason("Force a password reset for ops@example.com");
      await waitFor(() => expect(fake.count("GET /admins")).toBe(6));
      cleanup();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: REASON } });
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
      await waitFor(() => expect(within(rowOf("new@example.com")).getAllByRole("cell")[5].textContent).toBe("invited"));

      expect(fake.calls).toEqual(expect.arrayContaining(["POST /admins/ops/suspend", "POST /admins/ops/reactivate", "POST /admins/ops/reset-mfa", "PUT /admins/ops/role", "POST /admins/ops/force-password-reset", "POST /invitations"]));
      await waitFor(() => expect(fake.count("GET /admins")).toBe(8));
    });
  });

  describe("criterion 2: the invitation link is shown once and kept nowhere", () => {
    it("shows the link with the single-use note, then it is gone after closing: not in storage, URL or a re-opened dialog", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: REASON } });

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
      await renderDetail(fake, "late");

      click("Resend");
      await giveReason("Resend the invitation of late@example.com");

      expect((await screen.findByLabelText("Invitation link") as HTMLInputElement).value).toBe(SECRET_LINK);
      fireEvent.click(within(screen.getByRole("dialog", { name: "Invitation created" })).getByRole("button", { name: "Close" }));
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
      const fake = expired();
      await renderScreen(fake);
      expect(within(rowOf("late@example.com")).getAllByRole("cell")[5].textContent).toBe("invited, expired");
      cleanup();

      const detail = await renderDetail(fake, "late");

      expect(field("Invitation")).toBe("invited, expired");
      expect(within(detail).getByRole("button", { name: "Resend" })).toBeTruthy();
      expect(within(detail).getByRole("button", { name: "Revoke" })).toBeTruthy();
      click("Revoke");
      await giveReason("Revoke the invitation of late@example.com");
      expect(await screen.findByText("This invitation was revoked.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Admins and roles" }).getAttribute("href")).toBe("/admins-and-roles");
      expect(screen.queryAllByRole("button")).toEqual([]);
      expect(screen.queryByText("late@example.com")).toBeNull();
    });

    it("inviting the same email shows the API's 409 message and offers that invitation's resend and revoke", async () => {
      const fake = expired();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "late@example.com" } });
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: REASON } });

      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

      const dialog = await screen.findByRole("dialog", { name: "Invite an admin" });
      expect((await within(dialog).findByRole("alert")).textContent).toBe("An invitation for this email is already pending");
      expect(within(dialog).getByRole("button", { name: "Revoke invitation" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Resend invitation" }));
      expect((await screen.findByLabelText("Invitation link") as HTMLInputElement).value).toBe(SECRET_LINK);
      expect(fake.calls).toContain("POST /invitations/late/resend");
      expect(fake.reasonsOf("POST /invitations/late/resend")).toEqual([REASON]);
      expect(screen.queryByRole("dialog", { name: "Invite an admin" })).toBeNull();
    });
  });

  describe("criterion 4: sensitive actions ask for a fresh password and TOTP", () => {
    it("sends the action, is refused, asks, sends reauth, then retries the action once", async () => {
      const fake = createFakeApi();
      await renderDetail(fake, "ops");
      click("Suspend / remove access");
      await giveReason("Suspend ops@example.com");
      const prompt = await screen.findByRole("dialog", { name: "Confirm it is you" });
      expect(within(prompt).getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
      expect(within(prompt).getByLabelText("Authenticator code").getAttribute("autocomplete")).toBe("one-time-code");
      expect(fake.calls.filter((call) => call.includes("suspend"))).toEqual(["POST /admins/ops/suspend"]);
      await confirmIdentity();

      await waitFor(() => expect(field("Status")).toBe("suspended"));
      expect(fake.calls.filter((call) => call.includes("suspend") || call.includes("reauth"))).toEqual(["POST /admins/ops/suspend", "POST /auth/reauth", "POST /admins/ops/suspend"]);
      expect(fake.reasonsOf("POST /admins/ops/suspend")).toEqual([REASON, REASON]);
      expect(screen.queryByRole("dialog", { name: "Confirm it is you" })).toBeNull();
    });

    it("a wrong code shows the API's refusal and nothing changes; the right one then works", async () => {
      const fake = createFakeApi();
      await renderDetail(fake, "ops");
      click("Suspend / remove access");
      await giveReason("Suspend ops@example.com");

      await confirmIdentity("pw", "000000");

      expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
      expect(field("Status")).toBe("active");
      expect(fake.count("POST /admins/ops/suspend")).toBe(1);
      expect(fake.state.admins.find((entry) => entry.id === "ops")?.status).toBe("active");
      await confirmIdentity();
      await waitFor(() => expect(field("Status")).toBe("suspended"));
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
      render(<AdminDetailScreen adminId="ops" api={api} sessionApi={sessionOf(profile(OWNER_PERMISSIONS))} />);
      await screen.findByRole("region", { name: "Admin ops@example.com" });
      click("Suspend / remove access");
      await giveReason("Suspend ops@example.com");

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
      await renderDetail(fake, "ops");
      click("Suspend / remove access");
      await giveReason("Suspend ops@example.com");
      await screen.findByRole("dialog", { name: "Confirm it is you" });

      click("Cancel");

      expect((await screen.findByRole("alert")).textContent).toBe("Re-authentication was cancelled.");
      expect(fake.count("POST /admins/ops/suspend")).toBe(1);
      expect(fake.count("POST /auth/reauth")).toBe(0);
      expect(field("Status")).toBe("active");
    });
  });

  describe("criterion 5: controls follow the permissions", () => {
    it("without admins:write and roles:write no write control is shown", async () => {
      const fake = createFakeApi();
      fake.state.admins.push(admin("late", { status: "invited", invitationExpiresAt: PAST }));
      await renderScreen(fake, profile(["admins:read", "roles:read"], "viewer"));

      expect(screen.queryByRole("button", { name: /Invite admin|Create role/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Edit role|Delete role/ })).toBeNull();
      expect(screen.getByRole("table", { name: "Roles" })).toBeTruthy();
      for (const id of ["ops", "late"]) {
        cleanup();
        await renderDetail(fake, id, profile(["admins:read", "roles:read"], "viewer"));
        expect(screen.queryAllByRole("button")).toEqual([]);
        expect(screen.queryAllByRole("combobox")).toEqual([]);
      }
    });

    it("with roles:write but not admins:write: role assignment and role writes, no admin actions", async () => {
      const fake = createFakeApi();
      const manager = profile(["admins:read", "roles:read", "roles:write"], "mgr");
      await renderScreen(fake, manager);
      expect(screen.getByRole("button", { name: "Create role" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Invite admin" })).toBeNull();
      cleanup();

      await renderDetail(fake, "ops", manager);

      expect(screen.getByRole("button", { name: "Save role for ops@example.com" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Suspend|Reset MFA|Force password/ })).toBeNull();
    });

    it("without admins:read the admin list is not shown, without roles:read the roles are not", async () => {
      const fake = createFakeApi();
      await renderScreen(fake, profile(["admins:read"], "ops"));

      expect(screen.queryByRole("table", { name: "Roles" })).toBeNull();
      expect(fake.calls).toEqual(["GET /admins"]);
    });

    it("the signed-in admin's own detail has no role change (others do)", async () => {
      const fake = createFakeApi();

      expect(within(await renderDetail(fake, "owner")).queryByRole("combobox")).toBeNull();
      cleanup();
      expect(within(await renderDetail(fake, "ops")).getByRole("combobox")).toBeTruthy();
    });
  });

  describe("criterion 6: the API's refusals are shown and nothing changes", () => {
    it("the last active owner cannot be suspended", async () => {
      const fake = createFakeApi({ isReauthed: true });
      fake.state.admins = [admin("owner", { role: "owner" }), admin("owner2", { role: "owner" }), admin("ops", { status: "suspended" })];
      fake.state.admins[1] = { ...fake.state.admins[1], status: "suspended" };
      await renderDetail(fake, "owner", profile(OWNER_PERMISSIONS, "ops"));

      click("Suspend / remove access");
      await giveReason("Suspend owner@example.com");

      expect((await screen.findByRole("alert")).textContent).toBe("The last active owner cannot be suspended");
      expect(field("Status")).toBe("active");
    });

    it("taking the Owner role from the last active owner", async () => {
      const fake = createFakeApi({ isReauthed: true });
      fake.state.admins = [admin("owner", { role: "owner" }), admin("ops")];
      await renderDetail(fake, "owner", profile(OWNER_PERMISSIONS, "ops"));
      pickOption(screen.getByLabelText("Role for owner@example.com"), "support");

      click("Save role for owner@example.com");
      await giveReason("Change the role of owner@example.com to support");

      expect((await screen.findByRole("alert")).textContent).toBe("The last active owner keeps the Owner role");
      expect(field("Role")).toBe("owner");
    });

    it("a role name that is taken keeps the form open with the API's message; a 400 shows its status text", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Create role");
      const form = screen.getByRole("dialog", { name: "Create a role" });
      fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "custom_ro" } });
      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: REASON } });

      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));
      await confirmIdentity();

      expect((await within(form).findByRole("alert")).textContent).toBe("A role with this name already exists");
      expect(fake.state.roles.filter((entry) => entry.name === "custom_ro")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Create a role" })).toBeTruthy();
    });

    it("an API refusal without a text message (e.g. a 400 with field errors) shows the status", async () => {
      const refusing: ApiClient = { request: async () => ({ ok: false, status: 400, json: async () => ({ permissions: ["bad"] }) }) as Response };
      const api = createAdminsApi(refusing, refusing);

      await expect(api.createRole({ name: "x", permissions: ["bad"] }, REASON)).rejects.toThrow("The request was refused (400).");
    });
  });

  describe("invite dialog (RNX-291)", () => {
    it("invites with the role picked in the select, not the default one", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
      pickOption(screen.getByRole("combobox", { name: "Role" }), "custom_ro");
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: REASON } });
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
      await waitFor(() => expect(within(rowOf("new@example.com")).getAllByRole("cell")[2].textContent).toBe("custom_ro"));
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
      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: REASON } });

      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));
      await confirmIdentity();

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
      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: REASON } });

      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));
      await confirmIdentity();

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create a role" })).toBeNull());
      expect(fake.state.roles.at(-1)).toMatchObject({ name: "profit_viewer", permissions: ["profit:read", "reconciliation:write"] });
    });

    it("edits a custom role after re-authentication, sending only what changed", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Edit role custom_ro");
      const form = screen.getByRole("dialog", { name: "Edit role custom_ro" });
      fireEvent.click(within(form).getByLabelText("usage:read"));
      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: REASON } });
      fireEvent.click(within(form).getByRole("button", { name: "Save role" }));

      await confirmIdentity();

      await waitFor(() => expect(within(screen.getByRole("table", { name: "Roles" })).getByText("users:read, usage:read")).toBeTruthy());
      expect(fake.calls.filter((call) => call.includes("custom_ro"))).toEqual(["PATCH /roles/custom_ro", "PATCH /roles/custom_ro"]);
      expect(fake.reasonsOf("PATCH /roles/custom_ro")).toEqual([REASON, REASON]);
    });
  });

  describe("criterion 7: deleting a custom role", () => {
    it("a role nobody holds leaves the list", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);

      click("Delete role custom_ro");
      await giveReason("Delete role custom_ro");
      await confirmIdentity();

      await waitFor(() => expect(within(screen.getByRole("table", { name: "Roles" })).queryByText("custom_ro")).toBeNull());
      expect(fake.calls).toContain("DELETE /roles/custom_ro");
    });

    it("a held role shows the API's 409 and stays", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);

      click("Delete role held_role");
      await giveReason("Delete role held_role");
      await confirmIdentity();

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

  describe("RNX-370 AC3: every admin write asks for the reason and sends it; with no reason nothing is sent", () => {
    /** The page with an active (ops), a suspended (gone) admin and a pending invitation (late), not re-authenticated. */
    const withEveryState = () => {
      const fake = createFakeApi();
      fake.state.admins.push(admin("gone", { status: "suspended" }), admin("late", { status: "invited", name: null, mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: FUTURE }));
      return fake;
    };
    // (button, reason dialog title, page id, request, whether the API asks for a re-authentication first)
    const DETAIL_WRITES: readonly (readonly [string, string, string, string, boolean])[] = [
      ["Suspend / remove access", "Suspend ops@example.com", "ops", "POST /admins/ops/suspend", true],
      ["Reactivate", "Reactivate gone@example.com", "gone", "POST /admins/gone/reactivate", true],
      ["Reset MFA", "Reset the MFA of ops@example.com", "ops", "POST /admins/ops/reset-mfa", true],
      ["Force password reset", "Force a password reset for ops@example.com", "ops", "POST /admins/ops/force-password-reset", true],
      ["Resend", "Resend the invitation of late@example.com", "late", "POST /invitations/late/resend", false],
      ["Revoke", "Revoke the invitation of late@example.com", "late", "DELETE /invitations/late", false],
    ];

    it.each(DETAIL_WRITES)("%s: confirming with a reason sends the request carrying it (again after a re-authentication)", async (button, title, id, request, isGated) => {
      const fake = withEveryState();
      await renderDetail(fake, id);

      click(button);
      await giveReason(title);
      if (isGated) await confirmIdentity();

      await waitFor(() => expect(fake.reasonsOf(request)).toEqual(isGated ? [REASON, REASON] : [REASON]));
      expect(writesOf(fake)).toEqual(isGated ? [request, request] : [request]);
    });

    it.each(DETAIL_WRITES)("%s: with the reason empty or only spaces Confirm is disabled and no request fires; Esc closes it", async (button, title, id) => {
      const fake = withEveryState();
      await renderDetail(fake, id);

      click(button);
      const dialog = await screen.findByRole("dialog", { name: title });
      const confirm = within(dialog).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
      const isDisabledWhenEmpty = confirm.disabled;
      fireEvent.click(confirm);
      fireEvent.change(within(dialog).getByLabelText(REASON_LABEL), { target: { value: "   " } });
      const isDisabledWhenBlank = confirm.disabled;
      fireEvent.click(confirm);
      fireEvent.keyDown(dialog, { key: "Escape" });

      expect([isDisabledWhenEmpty, isDisabledWhenBlank]).toEqual([true, true]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
      expect(writesOf(fake)).toEqual([]);
    });

    it("change role: Save asks for the reason; confirming sends the role and the reason (again after a re-authentication)", async () => {
      const fake = withEveryState();
      await renderDetail(fake, "ops");
      pickOption(screen.getByLabelText("Role for ops@example.com"), "custom_ro");

      click("Save role for ops@example.com");
      await giveReason("Change the role of ops@example.com to custom_ro");
      await confirmIdentity();

      await waitFor(() => expect(fake.reasonsOf("PUT /admins/ops/role")).toEqual([REASON, REASON]));
      expect(fake.sent.filter((entry) => entry.call === "PUT /admins/ops/role").map((entry) => entry.body.role)).toEqual(["custom_ro", "custom_ro"]);
    });

    it("change role: with the reason empty or only spaces Confirm is disabled and no request fires; the close button closes it", async () => {
      const fake = withEveryState();
      await renderDetail(fake, "ops");
      click("Save role for ops@example.com");
      const dialog = await screen.findByRole("dialog", { name: "Change the role of ops@example.com to support" });
      const confirm = within(dialog).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
      const isDisabledWhenEmpty = confirm.disabled;
      fireEvent.change(within(dialog).getByLabelText(REASON_LABEL), { target: { value: "  " } });
      fireEvent.click(confirm);

      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

      expect([isDisabledWhenEmpty, confirm.disabled]).toEqual([true, true]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /Change the role/ })).toBeNull());
      expect(writesOf(fake)).toEqual([]);
    });

    it("invite: Send invitation carries the reason; with it empty or only spaces the button is disabled and nothing is sent", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Invite admin");
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
      const send = screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement;
      const isDisabledWhenEmpty = send.disabled;
      fireEvent.click(send);
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: "   " } });
      const isDisabledWhenBlank = send.disabled;
      fireEvent.submit(send.closest("form") as HTMLFormElement);
      const writesWithoutReason = writesOf(fake);

      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: REASON } });
      fireEvent.click(send);

      expect([isDisabledWhenEmpty, isDisabledWhenBlank, writesWithoutReason]).toEqual([true, true, []]);
      await waitFor(() => expect(fake.reasonsOf("POST /invitations")).toEqual([REASON]));
    });

    it("create role: Save role carries the reason, again after the re-authentication; with it empty or only spaces Save is disabled and nothing is sent", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Create role");
      const form = screen.getByRole("dialog", { name: "Create a role" });
      fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "finance_ro" } });
      const save = within(form).getByRole("button", { name: "Save role" }) as HTMLButtonElement;
      const isDisabledWhenEmpty = save.disabled;
      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: "   " } });
      const isDisabledWhenBlank = save.disabled;
      fireEvent.submit(form);
      const writesWithoutReason = writesOf(fake);

      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: REASON } });
      fireEvent.click(save);
      await confirmIdentity();

      expect([isDisabledWhenEmpty, isDisabledWhenBlank, writesWithoutReason]).toEqual([true, true, []]);
      await waitFor(() => expect(fake.reasonsOf("POST /roles")).toEqual([REASON, REASON]));
      expect(fake.state.roles.at(-1)?.name).toBe("finance_ro");
    });

    it("edit role: Save role carries the reason; with it empty or only spaces Save is disabled and nothing is sent", async () => {
      const fake = createFakeApi({ isReauthed: true });
      await renderScreen(fake);
      click("Edit role custom_ro");
      const form = screen.getByRole("dialog", { name: "Edit role custom_ro" });
      fireEvent.click(within(form).getByLabelText("usage:read"));
      const save = within(form).getByRole("button", { name: "Save role" }) as HTMLButtonElement;
      const isDisabledWhenEmpty = save.disabled;
      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: " " } });
      const isDisabledWhenBlank = save.disabled;
      fireEvent.submit(form);
      const writesWithoutReason = writesOf(fake);

      fireEvent.change(within(form).getByLabelText(REASON_LABEL), { target: { value: REASON } });
      fireEvent.click(save);

      expect([isDisabledWhenEmpty, isDisabledWhenBlank, writesWithoutReason]).toEqual([true, true, []]);
      await waitFor(() => expect(fake.reasonsOf("PATCH /roles/custom_ro")).toEqual([REASON]));
    });

    it("delete role: confirming with a reason sends it, again after the re-authentication", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);

      click("Delete role custom_ro");
      await giveReason("Delete role custom_ro");
      await confirmIdentity();

      await waitFor(() => expect(fake.reasonsOf("DELETE /roles/custom_ro")).toEqual([REASON, REASON]));
      expect(writesOf(fake)).toEqual(["DELETE /roles/custom_ro", "DELETE /roles/custom_ro"]);
    });

    it("delete role: with the reason empty or only spaces Confirm is disabled and no request fires; Cancel closes it", async () => {
      const fake = createFakeApi();
      await renderScreen(fake);
      click("Delete role custom_ro");
      const dialog = await screen.findByRole("dialog", { name: "Delete role custom_ro" });
      const confirm = within(dialog).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
      const isDisabledWhenEmpty = confirm.disabled;
      fireEvent.change(within(dialog).getByLabelText(REASON_LABEL), { target: { value: "   " } });
      fireEvent.submit(confirm.closest("form") as HTMLFormElement);

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect([isDisabledWhenEmpty, confirm.disabled]).toEqual([true, true]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete role custom_ro" })).toBeNull());
      expect(writesOf(fake)).toEqual([]);
      expect(within(screen.getByRole("table", { name: "Roles" })).getByText("custom_ro")).toBeTruthy();
    });
  });
});
