import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { pickOption } from "@/test/pick-option";
import { AdminDetailPanel } from "./admin-detail-panel";

// RNX-373 (D436/D437/D443): the detail of an admin's page holds every admin write, shown by status and permission
// (visibility only), and the role changes on Save, not on select. Obviously fake values only.
// The role picker is the shared Select (Radix): the open list calls scrollIntoView, which jsdom does not have.
Element.prototype.scrollIntoView = jest.fn();

const admin = (id: string, overrides: Partial<AdminListEntry> = {}): AdminListEntry => ({
  id, status: "active", name: id, email: `${id}@example.com`, role: "support", mfa: "enrolled", lastSignInAt: "2026-10-20T08:00:00.000Z", ...overrides,
});
const ACTIVE = admin("ops");
const SUSPENDED = admin("gone", { status: "suspended" });
const INVITED = admin("late", { status: "invited", name: null, mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: "2999-01-01T00:00:00.000Z" });
const ROLES = [{ name: "owner", permissions: [], builtIn: true }, { name: "support", permissions: [], builtIn: true }, { name: "custom_ro", permissions: [], builtIn: false }];

type Options = { readonly canWriteAdmins?: boolean; readonly canWriteRoles?: boolean; readonly isOwnDetail?: boolean };

/** Renders the detail of `entry` alone (an earlier render is removed); `onAct` runs the action at once, so each click reaches the API double. */
function renderDetail(entry: AdminListEntry, { canWriteAdmins = true, canWriteRoles = true, isOwnDetail = false }: Options = {}) {
  const api = {
    suspend: jest.fn(async () => undefined),
    reactivate: jest.fn(async () => undefined),
    resetMfa: jest.fn(async () => undefined),
    forcePasswordReset: jest.fn(async () => undefined),
    revokeInvitation: jest.fn(async () => undefined),
    assignRole: jest.fn(async () => undefined),
  };
  const onResend = jest.fn();
  cleanup();
  render(<AdminDetailPanel entry={entry} api={api as unknown as AdminsApi} roles={ROLES} isOwnDetail={isOwnDetail} canWriteAdmins={canWriteAdmins} canWriteRoles={canWriteRoles} onAct={(action) => void action()} onResend={onResend} />);
  return { api, onResend, detail: screen.getByRole("region", { name: `Admin ${entry.email}` }) };
}
const namesOfButtons = (container: HTMLElement): string[] => within(container).queryAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
const clickIn = (container: HTMLElement, name: string) => fireEvent.click(within(container).getByRole("button", { name }));

describe("admin detail: what it shows", () => {
  it("the list entry's fields, with the focus on its heading", () => {
    const { detail } = renderDetail(ACTIVE);
    expect(document.activeElement).toBe(within(detail).getByRole("heading", { name: "Admin ops@example.com" }));
    expect(within(detail).getAllByRole("definition").map((cell) => cell.textContent)).toEqual(["ops", "ops@example.com", "support", "enrolled", "2026-10-20T08:00:00.000Z", "active"]);
  });

  it("an invitation's status and its expiry", () => {
    const { detail } = renderDetail(INVITED);
    expect(within(detail).getAllByRole("term").map((cell) => cell.textContent)).toEqual(["Name", "Email", "Role", "MFA", "Last sign-in", "Invitation", "Invitation expires"]);
    expect(within(detail).getAllByRole("definition").slice(5).map((cell) => cell.textContent)).toEqual(["invited", "2999-01-01T00:00:00.000Z"]);
  });
});

describe("admin detail: the allowed actions show and each fires its request (AC2)", () => {
  it("an active admin: Suspend / remove access, Reset MFA, Force password reset", () => {
    const { api, detail } = renderDetail(ACTIVE);
    expect(namesOfButtons(detail)).toEqual(["Save role for ops@example.com", "Suspend / remove access", "Reset MFA", "Force password reset"]);
    clickIn(detail, "Suspend / remove access");
    expect(api.suspend.mock.calls).toEqual([["ops"]]);
    clickIn(detail, "Reset MFA");
    expect(api.resetMfa.mock.calls).toEqual([["ops"]]);
    clickIn(detail, "Force password reset");
    expect(api.forcePasswordReset.mock.calls).toEqual([["ops"]]);
    expect(api.reactivate).not.toHaveBeenCalled();
  });

  it("a suspended admin: Reactivate instead of Suspend", () => {
    const { api, detail } = renderDetail(SUSPENDED);
    expect(within(detail).queryByRole("button", { name: /Suspend/ })).toBeNull();
    clickIn(detail, "Reactivate");
    expect(api.reactivate.mock.calls).toEqual([["gone"]]);
    expect(api.suspend).not.toHaveBeenCalled();
  });

  it("an invitation: Resend and Revoke only, no role change", () => {
    const { api, onResend, detail } = renderDetail(INVITED);
    expect(namesOfButtons(detail)).toEqual(["Resend", "Revoke"]);
    expect(within(detail).queryByRole("combobox")).toBeNull();
    clickIn(detail, "Resend");
    expect(onResend.mock.calls).toEqual([["late"]]);
    clickIn(detail, "Revoke");
    expect(api.revokeInvitation.mock.calls).toEqual([["late"]]);
  });

  it("the role changes on Save with the picked role, not when it is picked", () => {
    const { api, detail } = renderDetail(ACTIVE);
    pickOption(within(detail).getByRole("combobox", { name: "Role for ops@example.com" }), "custom_ro");
    expect(api.assignRole).not.toHaveBeenCalled();
    clickIn(detail, "Save role for ops@example.com");
    expect(api.assignRole.mock.calls).toEqual([["ops", "custom_ro"]]);
  });

  it("without admins:write: the role change only; nothing on an invitation", () => {
    expect(namesOfButtons(renderDetail(ACTIVE, { canWriteAdmins: false }).detail)).toEqual(["Save role for ops@example.com"]);
    expect(namesOfButtons(renderDetail(INVITED, { canWriteAdmins: false }).detail)).toEqual([]);
  });

  it("without roles:write: the account actions, no role change", () => {
    const { detail } = renderDetail(ACTIVE, { canWriteRoles: false });
    expect(within(detail).queryByRole("combobox")).toBeNull();
    expect(namesOfButtons(detail)).toEqual(["Suspend / remove access", "Reset MFA", "Force password reset"]);
  });

  it("without either permission: no control on an active, a suspended or an invited detail", () => {
    for (const entry of [ACTIVE, SUSPENDED, INVITED]) {
      const { detail } = renderDetail(entry, { canWriteAdmins: false, canWriteRoles: false });
      expect(namesOfButtons(detail)).toEqual([]);
      expect(within(detail).queryByRole("combobox")).toBeNull();
    }
  });
});

describe("one's own detail (AC3)", () => {
  it("offers no role change; the account actions stay", () => {
    const { detail } = renderDetail(admin("owner", { role: "owner" }), { isOwnDetail: true });
    expect(within(detail).queryByRole("combobox")).toBeNull();
    expect(namesOfButtons(detail)).toEqual(["Suspend / remove access", "Reset MFA", "Force password reset"]);
  });
});
