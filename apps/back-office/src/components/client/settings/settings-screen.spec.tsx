import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { RefusedError } from "@/lib/sign-in/refused-error";
import type { SettingsApi } from "@/lib/settings/settings-api";
import { SettingsScreen } from "./settings-screen";

// RNX-98: the settings screen against a fake of SettingsApi; the API's schema and permissions are tested in apps/api.

const profile = (permissions: string[]): AdminProfile => ({ id: "a", email: "a@example.com", name: "a", role: "r", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z" });
const sessionOf = (permissions: string[]): SessionApi => ({ me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined });
const apiOf = (saveSetting: SettingsApi["saveSetting"]): SettingsApi => ({
  listSettings: async () => [{ name: "seatCeiling", value: 100 }, { name: "graceDays", value: null }],
  saveSetting,
});

describe("SettingsScreen", () => {
  it("labels the settings nothing reads yet and shows an unset value as not set", async () => {
    render(<SettingsScreen api={apiOf(jest.fn())} sessionApi={sessionOf(["settings:read"])} />);
    expect(await screen.findByText("not applied yet")).toBeTruthy();
    expect(screen.getByText("not set")).toBeTruthy();
  });

  it("hides Edit without settings:write", async () => {
    render(<SettingsScreen api={apiOf(jest.fn())} sessionApi={sessionOf(["settings:read"])} />);
    await screen.findByText("100");
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("sends the value with its reason and shows the API's refusal", async () => {
    const save = jest.fn(async () => { throw new RefusedError("value: too large", 400); });
    render(<SettingsScreen api={apiOf(save)} sessionApi={sessionOf(["settings:read", "settings:write"])} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Seat ceiling per company (D7)" }));
    fireEvent.change(screen.getByLabelText("Seat ceiling per company (D7)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), { target: { value: "contract" } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
    await waitFor(() => expect(screen.getByText("value: too large")).toBeTruthy());
    expect(save).toHaveBeenCalledWith("seatCeiling", 90, "contract");
  });

  it("lets a decimal percentage be entered and saved (RNX-228's gateway fee: step any, not whole numbers)", async () => {
    const save = jest.fn(async () => undefined);
    const api: SettingsApi = { listSettings: async () => [{ name: "paymentGatewayFeePercent", value: null }], saveSetting: save };
    render(<SettingsScreen api={api} sessionApi={sessionOf(["settings:read", "settings:write"])} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Payment gateway fee, % of gross (RNX-228)" }));
    const input = screen.getByLabelText("Payment gateway fee, % of gross (RNX-228)");
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), { target: { value: "gateway contract" } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));

    expect(input.getAttribute("step")).toBe("any");
    await waitFor(() => expect(save).toHaveBeenCalledWith("paymentGatewayFeePercent", 2.5, "gateway contract"));
  });
});

describe("SettingsScreen boolean and list settings (RNX-315)", () => {
  const NOTE = "Read-only: this screen edits number settings only.";
  const api: SettingsApi = {
    listSettings: async () => [{ name: "seatCeiling", value: 100 }, { name: "paymentsEnabled", value: true }, { name: "paymentsAllowedUserIds", value: ["user-1", "user-2"] }],
    saveSetting: jest.fn(),
  };
  const rowOf = (label: string) => screen.getByText(label).closest("tr") as HTMLElement;

  it("shows a boolean as on or off and a list comma separated, each read-only with the note, even with settings:write", async () => {
    render(<SettingsScreen api={api} sessionApi={sessionOf(["settings:read", "settings:write"])} />);

    await screen.findByText("Payments switch (RNX-35)");

    expect(within(rowOf("Payments switch (RNX-35)")).getByText("on")).toBeTruthy();
    expect(within(rowOf("Payments switch (RNX-35)")).getByText(NOTE)).toBeTruthy();
    expect(within(rowOf("Payments: pilot allow-list, user ids (RNX-35)")).getByText("user-1, user-2")).toBeTruthy();
    expect(within(rowOf("Payments: pilot allow-list, user ids (RNX-35)")).getByText(NOTE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit Payments/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Seat ceiling per company (D7)" })).toBeTruthy();
    expect(within(rowOf("Seat ceiling per company (D7)")).queryByText(NOTE)).toBeNull();
  });

  it("keeps a boolean or list setting without a value read-only: not set, no Edit (a number form would be refused)", async () => {
    const unset: SettingsApi = { listSettings: async () => [{ name: "paymentsEnabled", value: null }, { name: "paymentsAllowedUserIds", value: [] }], saveSetting: jest.fn() };
    render(<SettingsScreen api={unset} sessionApi={sessionOf(["settings:read", "settings:write"])} />);

    await screen.findByText("Payments switch (RNX-35)");

    expect(within(rowOf("Payments switch (RNX-35)")).getByText("not set")).toBeTruthy();
    expect(within(rowOf("Payments: pilot allow-list, user ids (RNX-35)")).getByText("empty")).toBeTruthy();
    expect(screen.getAllByText(NOTE)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });
});
