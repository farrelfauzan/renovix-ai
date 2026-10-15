import { render, screen } from "@testing-library/react";
import { SideNavigation } from "./side-navigation";

jest.mock("next/navigation", () => ({ usePathname: () => "/companies" }));

describe("SideNavigation", () => {
  it("lists the 11 v1 items, in order, each linking to its route", () => {
    render(<SideNavigation />);
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
  });

  it("marks only the current route", () => {
    render(<SideNavigation />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Companies"]);
  });
});
