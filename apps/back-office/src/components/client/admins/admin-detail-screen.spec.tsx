import { render, screen } from "@testing-library/react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { AdminDetailScreen } from "./admin-detail-screen";

// RNX-373 (D443): the page of one admin reads that admin from the admin list by the id in its route. Its writes,
// the re-authentication prompt and the API's refusals are tested against the stateful fake in
// admins-and-roles-screen.spec.tsx; here: the back link, an unknown id, and what is asked of the API.
const OPS: AdminListEntry = { id: "ops", status: "active", name: "ops", email: "ops@example.com", role: "support", mfa: "enrolled", lastSignInAt: null };
const profile = (permissions: string[]): AdminProfile => ({
  id: "owner", email: "owner@example.com", name: "owner", role: "owner", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z",
});
function renderPage(adminId: string, permissions: string[], listAdmins: () => Promise<readonly AdminListEntry[]> = async () => [OPS]) {
  const api = { listAdmins: jest.fn(listAdmins), listRoles: jest.fn(async () => []), reauth: jest.fn() };
  const sessionApi: SessionApi = { me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined };
  render(<AdminDetailScreen adminId={adminId} api={api as unknown as AdminsApi} sessionApi={sessionApi} />);
  return api;
}
const backLink = () => screen.getByRole("link", { name: "Admins and roles" }).getAttribute("href");

describe("admin page (AC3)", () => {
  it("shows the admin with this id from the list, with the back link to the list", async () => {
    const api = renderPage("ops", ["admins:read", "roles:read"]);
    expect(await screen.findByRole("region", { name: "Admin ops@example.com" })).toBeTruthy();
    expect(backLink()).toBe("/admins-and-roles");
    expect(api.listAdmins).toHaveBeenCalledTimes(1);
    expect(api.listRoles).toHaveBeenCalledTimes(1);
  });

  it("an unknown id: not found, the back link, and no action", async () => {
    renderPage("nobody", ["admins:read", "admins:write", "roles:read", "roles:write"]);
    expect(await screen.findByText("No admin or invitation has this id.")).toBeTruthy();
    expect(backLink()).toBe("/admins-and-roles");
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
  });

  it("without admins:read and roles:read neither list is asked for, and nothing is shown but not found", async () => {
    const api = renderPage("ops", []);
    expect(await screen.findByText("No admin or invitation has this id.")).toBeTruthy();
    expect(api.listAdmins).not.toHaveBeenCalled();
    expect(api.listRoles).not.toHaveBeenCalled();
  });

  it("says so when the list cannot be loaded", async () => {
    renderPage("ops", ["admins:read"], async () => {
      throw new Error("down");
    });
    expect((await screen.findByRole("alert")).textContent).toBe("The admin could not be loaded.");
  });
});
