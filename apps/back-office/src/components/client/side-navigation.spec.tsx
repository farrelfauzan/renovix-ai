import { render, screen } from "@testing-library/react";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { SignedInAdminContext } from "@/lib/session/signed-in-admin-context";
import { SideNavigation } from "./side-navigation";

jest.mock("next/navigation", () => ({ usePathname: () => "/companies" }));

const profile = (permissions: string[]): AdminProfile => ({
  id: "a", email: "a@example.com", name: "a", role: "r", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true,
  idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z",
});

/** The side menu as the session gate shows it, for a role holding these permissions; returns the link labels. */
function renderNavigation(permissions: string[]): (string | null)[] {
  render(
    <SignedInAdminContext value={profile(permissions)}>
      <SideNavigation />
    </SignedInAdminContext>,
  );
  return screen.getAllByRole("link").map((a) => a.textContent);
}

describe("SideNavigation", () => {
  it("with providers:read and packages:read: the 11 v1 items, in order, each linking to its route, the Platform group last", () => {
    renderNavigation(["providers:read", "packages:read"]);

    const links = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Overview", "/"],
      ["Enterprise requests", "/enterprise-requests"],
      ["Companies", "/companies"],
      ["Users", "/users"],
      ["Packages and credits", "/packages-and-credits"],
      ["Models and providers", "/models-and-providers"],
      ["Usage and cost", "/usage-and-cost"],
      ["Guardrails", "/guardrails"],
      ["Admins and roles", "/admins-and-roles"],
      ["Settings", "/settings"],
      ["Audit log", "/audit-log"],
    ]);
    expect(screen.getByRole("navigation").textContent).toMatch(/GuardrailsPlatformAdmins and roles/);
  });

  it("RNX-312a AC2: a role without providers:read and packages:read sees neither item; Overview, Enterprise requests, Companies, Users and Guardrails stay", () => {
    const labels = renderNavigation(["users:read", "audit:read"]);

    expect(labels).not.toContain("Models and providers");
    expect(labels).not.toContain("Packages and credits");
    expect(labels).toEqual(["Overview", "Enterprise requests", "Companies", "Users", "Usage and cost", "Guardrails", "Admins and roles", "Settings", "Audit log"]);
  });

  it.each([
    ["providers:read", "Models and providers", "Packages and credits"],
    ["packages:read", "Packages and credits", "Models and providers"],
  ])("RNX-312a AC2: a role with only %s sees %s, not %s", (permission, shown, hidden) => {
    const labels = renderNavigation([permission]);

    expect(labels).toContain(shown);
    expect(labels).not.toContain(hidden);
  });

  it("marks only the current route", () => {
    renderNavigation(["providers:read", "packages:read"]);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Companies"]);
  });
});
