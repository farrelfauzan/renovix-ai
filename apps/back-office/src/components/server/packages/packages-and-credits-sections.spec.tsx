import { fireEvent, render, screen } from "@testing-library/react";
import { PackagesAndCreditsSections } from "./packages-and-credits-sections";

// RNX-315: each tab of /packages-and-credits shows its existing section. The sections are stubbed here; their own
// specs (catalog-section, codes-section, credit-adjustment-panel, settings-screen) test them against fake APIs.
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
jest.mock("@/components/client/packages/catalog-section", () => ({ CatalogSection: ({ kind, title }: { kind: string; title: string }) => `catalog ${kind} ${title}` }));
jest.mock("@/components/client/codes/codes-section", () => ({ CodesSection: () => "codes section" }));
jest.mock("@/components/client/credits/credit-adjustment-panel", () => ({ CreditAdjustmentPanel: () => "credit adjustment panel" }));
jest.mock("@/components/client/settings/settings-screen", () => ({ SettingsScreen: () => "settings screen" }));

describe("PackagesAndCreditsSections (RNX-315)", () => {
  beforeEach(() => window.history.replaceState(null, "", "/packages-and-credits"));

  it("has the six tabs of the ticket, in order", () => {
    render(<PackagesAndCreditsSections />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Packages", "Top-ups", "Enterprise bundles", "Codes", "Credit adjustment", "Platform settings"]);
    expect(screen.getByRole("heading", { level: 1, name: "Packages and credits" })).toBeTruthy();
  });

  it.each([
    ["Packages", "catalog package Packages", "packages"],
    ["Top-ups", "catalog top-up-pack Top-up packs", "top-ups"],
    ["Enterprise bundles", "catalog enterprise-bundle Enterprise bundles", "enterprise-bundles"],
    ["Codes", "codes section", "codes"],
    ["Credit adjustment", "credit adjustment panel", "credit-adjustment"],
    ["Platform settings", "settings screen", "platform-settings"],
  ])("the %s tab shows its section (%s) and is ?tab=%s", (label, section, id) => {
    render(<PackagesAndCreditsSections />);
    // Radix reports no change for the tab already selected, so another tab is picked first.
    fireEvent.mouseDown(screen.getByRole("tab", { name: label === "Codes" ? "Packages" : "Codes" }));

    fireEvent.mouseDown(screen.getByRole("tab", { name: label }));

    expect(screen.getByRole("tabpanel").textContent).toContain(section);
    expect(window.location.search).toBe(`?tab=${id}`);
  });

  it("/settings's target, ?tab=platform-settings, opens the settings screen under its heading", () => {
    window.history.replaceState(null, "", "/packages-and-credits?tab=platform-settings");

    render(<PackagesAndCreditsSections />);

    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("settings screen");
    expect(screen.getByRole("heading", { level: 2, name: "Platform settings" })).toBeTruthy();
  });
});
