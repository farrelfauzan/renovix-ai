import { render, screen, within } from "@testing-library/react";
import type React from "react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import { AdminsTable } from "./admins-table";

// RNX-373 (D436/D437/D443): an admins row has one action, the icon-only Open, a link to the admin's own page; every
// write lives on that page. jsdom has no hover or focus-visible, so the shared tooltip is replaced by one that always
// shows its content, as the next sibling of its trigger. Obviously fake values only.
jest.mock("@performa-ai/ui/components/tooltip", () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});

const admin = (id: string, overrides: Partial<AdminListEntry> = {}): AdminListEntry => ({
  id, status: "active", name: id, email: `${id}@example.com`, role: "support", mfa: "enrolled", lastSignInAt: "2026-10-20T08:00:00.000Z", ...overrides,
});
const ADMINS = [
  admin("owner", { role: "owner" }),
  admin("gone", { status: "suspended" }),
  admin("inv 1/x", { status: "invited", name: null, email: "late@example.com", mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: "2999-01-01T00:00:00.000Z" }),
];

describe("admins table row (AC1)", () => {
  it("has the icon-only Open link to that admin's page as its only control, whatever the status", () => {
    render(<AdminsTable admins={ADMINS} />);
    const table = screen.getByRole("table", { name: "Admins" });
    expect(within(table).queryAllByRole("button")).toEqual([]);
    expect(within(table).queryAllByRole("combobox")).toEqual([]);
    const links = within(table).getAllByRole("link");
    expect(links.map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")])).toEqual([
      ["Open admin owner@example.com", "/admins-and-roles/owner"],
      ["Open admin gone@example.com", "/admins-and-roles/gone"],
      ["Open admin late@example.com", "/admins-and-roles/inv%201%2Fx"],
    ]);
    for (const link of links) {
      expect(link.textContent).toBe("");
      expect(link.nextElementSibling?.textContent).toBe("Open");
    }
  });
});
