import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PackagesTabPanel } from "@/lib/packages/packages-tab-panel";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import type { SettingsApi } from "@/lib/settings/settings-api";
import { SettingsScreen } from "../settings/settings-screen";
import { PackagesAndCreditsTabs } from "./packages-and-credits-tabs";

// RNX-315: the tabs of /packages-and-credits. The selected tab lives in ?tab= (jsdom's URL stands in for Next's search params).
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const PANELS: readonly PackagesTabPanel[] = [
  { id: "packages", label: "Packages", content: <p>packages section</p> },
  { id: "codes", label: "Codes", content: <p>codes section</p> },
  { id: "platform-settings", label: "Platform settings", content: <p>settings section</p> },
];
const profile = (permissions: string[]): AdminProfile => ({ id: "a", email: "a@example.com", name: "a", role: "r", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z" });
const sessionOf = (permissions: string[]): SessionApi => ({ me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined });

const openAt = (search: string, panels: readonly PackagesTabPanel[] = PANELS) => {
  window.history.replaceState(null, "", `/packages-and-credits${search}`);
  render(<PackagesAndCreditsTabs heading={<h1>Packages and credits</h1>} note={<p>note</p>} panels={panels} />);
};
/** Radix tabs select on mouse down (the primary button), not on click. */
const selectTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }));

describe("PackagesAndCreditsTabs (RNX-315)", () => {
  it("opens the first tab when the URL names none, and mounts only the selected section", () => {
    openAt("");

    expect(screen.getByRole("tab", { name: "Packages" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("packages section")).toBeTruthy();
    expect(screen.queryByText("codes section")).toBeNull();
    expect(screen.queryByText("settings section")).toBeNull();
  });

  it("opens the tab the URL names (a reload keeps the tab)", () => {
    openAt("?tab=codes");

    expect(screen.getByRole("tab", { name: "Codes" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("codes section")).toBeTruthy();
    expect(screen.queryByText("packages section")).toBeNull();
  });

  it("falls back to the first tab for an unknown tab id", () => {
    openAt("?tab=nope");

    expect(screen.getByText("packages section")).toBeTruthy();
  });

  it("picking a tab shows its section, unmounts the previous one and writes ?tab= to the URL", () => {
    openAt("");

    selectTab("Platform settings");

    expect(screen.getByText("settings section")).toBeTruthy();
    expect(screen.queryByText("packages section")).toBeNull();
    expect(window.location.pathname).toBe("/packages-and-credits");
    expect(window.location.search).toBe("?tab=platform-settings");
  });

  describe("AC4: the Platform settings tab needs settings:read, as /settings did", () => {
    const settingsPanels = (permissions: string[], listSettings: SettingsApi["listSettings"]): readonly PackagesTabPanel[] => [
      PANELS[0],
      { id: "platform-settings", label: "Platform settings", content: <SettingsScreen api={{ listSettings, saveSetting: jest.fn() }} sessionApi={sessionOf(permissions)} /> },
    ];

    it("an admin without settings:read gets the refusal line, no settings, and no settings read", async () => {
      const listSettings = jest.fn(async () => [{ name: "seatCeiling", value: 100 }]);
      openAt("?tab=platform-settings", settingsPanels(["packages:read"], listSettings));

      expect(await screen.findByText("Your role cannot view the platform settings (settings:read).")).toBeTruthy();
      expect(screen.queryByText("Seat ceiling per company (D7)")).toBeNull();
      expect(listSettings).not.toHaveBeenCalled();
    });

    it("an admin with settings:read gets the settings (control)", async () => {
      const listSettings = jest.fn(async () => [{ name: "seatCeiling", value: 100 }]);
      openAt("?tab=platform-settings", settingsPanels(["settings:read"], listSettings));

      expect(await screen.findByText("Seat ceiling per company (D7)")).toBeTruthy();
      await waitFor(() => expect(listSettings).toHaveBeenCalledTimes(1));
    });
  });
});
