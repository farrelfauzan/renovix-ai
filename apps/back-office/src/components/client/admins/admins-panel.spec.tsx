import { fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { pickOption } from "@/test/pick-option";
import { AdminsPanel } from "./admins-panel";

// RNX-373 (D436/D437): an admins row has one action, the icon-only Open; every write lives in the detail it opens,
// and the role changes on Save, not on select. jsdom has no hover or focus-visible, so the shared tooltip is replaced
// by one that always shows its content, as the next sibling of its button. Obviously fake values only.
jest.mock("@performa-ai/ui/components/tooltip", () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
// The role picker is the shared Select (Radix): the open list calls scrollIntoView, which jsdom does not have.
Element.prototype.scrollIntoView = jest.fn();

const admin = (id: string, overrides: Partial<AdminListEntry> = {}): AdminListEntry => ({
  id, status: "active", name: id, email: `${id}@example.com`, role: "support", mfa: "enrolled", lastSignInAt: "2026-10-20T08:00:00.000Z", ...overrides,
});
const ADMINS = [
  admin("owner", { role: "owner" }),
  admin("ops"),
  admin("gone", { status: "suspended" }),
  admin("late", { status: "invited", name: null, mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: "2999-01-01T00:00:00.000Z" }),
];
const ROLES = [{ name: "owner", permissions: [], builtIn: true }, { name: "support", permissions: [], builtIn: true }, { name: "custom_ro", permissions: [], builtIn: false }];
const WRITE_ACTIONS = /Suspend|Reactivate|Reset MFA|Force password reset|Resend|Revoke|Save/;

type Permissions = { readonly canWriteAdmins: boolean; readonly canWriteRoles: boolean };

/** Renders the panel as admin "owner"; `onAct` runs the action at once, so each click reaches the API double. */
function renderPanel({ canWriteAdmins, canWriteRoles }: Permissions = { canWriteAdmins: true, canWriteRoles: true }) {
  const api = {
    suspend: jest.fn(async () => undefined),
    reactivate: jest.fn(async () => undefined),
    resetMfa: jest.fn(async () => undefined),
    forcePasswordReset: jest.fn(async () => undefined),
    revokeInvitation: jest.fn(async () => undefined),
    assignRole: jest.fn(async () => undefined),
  };
  const onResend = jest.fn();
  render(
    <AdminsPanel admins={ADMINS} roles={ROLES} api={api as unknown as AdminsApi} currentAdminId="owner" canWriteAdmins={canWriteAdmins} canWriteRoles={canWriteRoles} run={jest.fn()} onAct={(action) => void action()} onIssued={jest.fn()} onResend={onResend} />,
  );
  return { api, onResend };
}
const openDetail = (email: string): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: `Open admin ${email}` }));
  return screen.getByRole("region", { name: `Admin ${email}` });
};
const namesOfButtons = (container: HTMLElement): string[] => within(container).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
const clickIn = (container: HTMLElement, name: string) => fireEvent.click(within(container).getByRole("button", { name }));

describe("admins table row (AC1)", () => {
  it("has the icon-only Open as its only control, whatever the status", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "Admins" });
    expect(namesOfButtons(table)).toEqual(ADMINS.map((entry) => `Open admin ${entry.email}`));
    expect(within(table).queryAllByRole("combobox")).toEqual([]);
    const open = within(table).getByRole("button", { name: "Open admin ops@example.com" });
    expect(open.textContent).toBe("");
    expect(open.nextElementSibling?.textContent).toBe("Open");
  });

  it("Open shows that admin's detail with the list entry's fields and moves the focus to its heading", () => {
    renderPanel();
    expect(screen.queryByRole("region", { name: /^Admin / })).toBeNull();
    const detail = openDetail("ops@example.com");
    expect(document.activeElement).toBe(within(detail).getByRole("heading", { name: "Admin ops@example.com" }));
    expect(within(detail).getAllByRole("definition").map((cell) => cell.textContent)).toEqual(["ops", "ops@example.com", "support", "enrolled", "2026-10-20T08:00:00.000Z", "active"]);
    const other = openDetail("gone@example.com");
    expect(document.activeElement).toBe(within(other).getByRole("heading"));
    expect(screen.queryByRole("region", { name: "Admin ops@example.com" })).toBeNull();
    clickIn(other, "Close");
    expect(screen.queryByRole("region", { name: /^Admin / })).toBeNull();
  });

  it("an invitation's detail shows the invitation status and its expiry", () => {
    renderPanel();
    const detail = openDetail("late@example.com");
    expect(within(detail).getAllByRole("term").map((cell) => cell.textContent)).toEqual(["Name", "Email", "Role", "MFA", "Last sign-in", "Invitation", "Invitation expires"]);
    expect(within(detail).getAllByRole("definition").slice(5).map((cell) => cell.textContent)).toEqual(["invited", "2999-01-01T00:00:00.000Z"]);
  });
});

describe("admin detail: the allowed actions show and each fires its request (AC2)", () => {
  it("an active admin: Suspend / remove access, Reset MFA, Force password reset", () => {
    const { api } = renderPanel();
    const detail = openDetail("ops@example.com");
    expect(namesOfButtons(detail)).toEqual(["Close", "Save role for ops@example.com", "Suspend / remove access", "Reset MFA", "Force password reset"]);
    clickIn(detail, "Suspend / remove access");
    expect(api.suspend.mock.calls).toEqual([["ops"]]);
    clickIn(detail, "Reset MFA");
    expect(api.resetMfa.mock.calls).toEqual([["ops"]]);
    clickIn(detail, "Force password reset");
    expect(api.forcePasswordReset.mock.calls).toEqual([["ops"]]);
    expect(api.reactivate).not.toHaveBeenCalled();
  });

  it("a suspended admin: Reactivate instead of Suspend", () => {
    const { api } = renderPanel();
    const detail = openDetail("gone@example.com");
    expect(within(detail).queryByRole("button", { name: /Suspend/ })).toBeNull();
    clickIn(detail, "Reactivate");
    expect(api.reactivate.mock.calls).toEqual([["gone"]]);
    expect(api.suspend).not.toHaveBeenCalled();
  });

  it("an invitation: Resend and Revoke only, no role change", () => {
    const { api, onResend } = renderPanel();
    const detail = openDetail("late@example.com");
    expect(namesOfButtons(detail)).toEqual(["Close", "Resend", "Revoke"]);
    clickIn(detail, "Resend");
    expect(onResend.mock.calls).toEqual([["late"]]);
    clickIn(detail, "Revoke");
    expect(api.revokeInvitation.mock.calls).toEqual([["late"]]);
  });

  it("the role changes on Save with the picked role, not when it is picked", () => {
    const { api } = renderPanel();
    const detail = openDetail("ops@example.com");
    pickOption(within(detail).getByRole("combobox", { name: "Role for ops@example.com" }), "custom_ro");
    expect(api.assignRole).not.toHaveBeenCalled();
    clickIn(detail, "Save role for ops@example.com");
    expect(api.assignRole.mock.calls).toEqual([["ops", "custom_ro"]]);
  });

  it("without admins:write: the role change only", () => {
    renderPanel({ canWriteAdmins: false, canWriteRoles: true });
    expect(namesOfButtons(openDetail("ops@example.com"))).toEqual(["Close", "Save role for ops@example.com"]);
    expect(namesOfButtons(openDetail("late@example.com"))).toEqual(["Close"]);
  });

  it("without roles:write: the account actions, no role change", () => {
    renderPanel({ canWriteAdmins: true, canWriteRoles: false });
    const detail = openDetail("ops@example.com");
    expect(within(detail).queryByRole("combobox")).toBeNull();
    expect(namesOfButtons(detail)).toEqual(["Close", "Suspend / remove access", "Reset MFA", "Force password reset"]);
  });

  it("without either permission: no write control on an active, a suspended or an invited detail", () => {
    renderPanel({ canWriteAdmins: false, canWriteRoles: false });
    for (const email of ["ops@example.com", "gone@example.com", "late@example.com"]) {
      const detail = openDetail(email);
      expect(within(detail).queryByRole("button", { name: WRITE_ACTIONS })).toBeNull();
      expect(namesOfButtons(detail)).toEqual(["Close"]);
    }
  });
});

describe("one's own detail (AC3)", () => {
  it("offers no role change; the account actions stay", () => {
    renderPanel();
    const detail = openDetail("owner@example.com");
    expect(within(detail).queryByRole("combobox")).toBeNull();
    expect(namesOfButtons(detail)).toEqual(["Close", "Suspend / remove access", "Reset MFA", "Force password reset"]);
  });
});
