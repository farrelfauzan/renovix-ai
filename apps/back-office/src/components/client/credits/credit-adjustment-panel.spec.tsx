import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReauthRequiredError } from "@/lib/admins/reauth-required-error";
import type { CreditAdjustmentEntry } from "@/lib/credits/credit-adjustment-entry";
import type { CreditsApi } from "@/lib/credits/credits-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { RefusedError } from "@/lib/sign-in/refused-error";
import { CreditAdjustmentPanel } from "./credit-adjustment-panel";

// RNX-99: the panel against a fake of CreditsApi. The ledger write, re-authentication window and permission are tested in apps/api (RNX-227).

const entry: CreditAdjustmentEntry = {
  entryId: "entry-1", accountId: "acct-1", wallet: "paid", amount: "20.5", balanceAfter: "32.9", adminId: "admin-1", actionId: "req-1", createdAt: "2026-10-22T05:00:00.000Z",
};
const profile = (permissions: string[]): AdminProfile => ({ id: "a", email: "a@example.com", name: "a", role: "r", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true });
const sessionOf = (permissions: string[]): SessionApi => ({ me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined });
const ADJUST = ["credits:adjust"];

const renderPanel = (adjust: CreditsApi["adjust"], permissions: string[], reauth: () => Promise<void> = async () => undefined) => {
  render(<CreditAdjustmentPanel api={{ adjust }} sessionApi={sessionOf(permissions)} reauth={reauth} />);
};
const fillAndSubmit = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText("User or company id (exact)"), { target: { value: "u_71ab" } });
  fireEvent.change(screen.getByLabelText("Credits"), { target: { value: "20.5" } });
  fireEvent.change(screen.getByLabelText("Ticket reference (optional)"), { target: { value: "SUP-118" } });
  fireEvent.change(screen.getByLabelText("Reason (required, audited)"), { target: { value: "goodwill" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adjust credits" })); });
};

describe("CreditAdjustmentPanel", () => {
  it("shows the ledger entry and the balance after the re-authentication prompt is passed", async () => {
    let isReauthed = false;
    const adjust = jest.fn(async () => {
      if (!isReauthed) throw new ReauthRequiredError("Re-authentication required", 403);
      return entry;
    });
    renderPanel(adjust, ADJUST, jest.fn(async () => { isReauthed = true; }));
    await fillAndSubmit();
    const prompt = await screen.findByRole("dialog", { name: "Confirm it is you" });
    fireEvent.change(within(prompt).getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.change(within(prompt).getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(within(prompt).getByRole("button", { name: "Confirm" }));
    const result = await screen.findByRole("status", { name: "Ledger entry" });
    expect(within(result).getByText("32.9")).toBeTruthy();
    expect(within(result).getByText("entry-1")).toBeTruthy();
    expect(adjust).toHaveBeenCalledTimes(2);
    const [firstInput, firstKey] = adjust.mock.calls[0] as unknown as [unknown, string];
    expect(adjust.mock.calls[1]).toEqual([firstInput, firstKey]);
    expect(firstInput).toEqual({ target: { userId: "u_71ab" }, amount: "20.5", direction: "add", reason: "goodwill", ticketReference: "SUP-118" });
  });

  it("changes nothing and shows the message when the re-authentication is cancelled", async () => {
    const adjust = jest.fn(async (): Promise<CreditAdjustmentEntry> => { throw new ReauthRequiredError("Re-authentication required", 403); });
    renderPanel(adjust, ADJUST);
    await fillAndSubmit();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Confirm it is you" })).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Re-authentication was cancelled.")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Ledger entry" })).toBeNull();
    expect(adjust).toHaveBeenCalledTimes(1);
  });

  it("shows a readable message and no balance when the API answers 403", async () => {
    const adjust = jest.fn(async (): Promise<CreditAdjustmentEntry> => { throw new RefusedError("Your role does not allow this (the API answered: Forbidden).", 403); });
    renderPanel(adjust, ADJUST);
    await fillAndSubmit();
    expect(await screen.findByText(/Your role does not allow this/)).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Ledger entry" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Confirm it is you" })).toBeNull();
  });

  it("hides the panel from an admin without credits:adjust", async () => {
    const sessionApi = { ...sessionOf(["packages:read"]), me: jest.fn(async () => profile(["packages:read"])) };
    render(<CreditAdjustmentPanel api={{ adjust: jest.fn() }} sessionApi={sessionApi} reauth={async () => undefined} />);
    await waitFor(() => expect(sessionApi.me).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("form", { name: "Credit adjustment" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Adjust credits" })).toBeNull();
  });

  it("does not call the API for an invalid amount", async () => {
    const adjust = jest.fn(async () => entry);
    renderPanel(adjust, ADJUST);
    fireEvent.change(await screen.findByLabelText("User or company id (exact)"), { target: { value: "u_1" } });
    fireEvent.change(screen.getByLabelText("Credits"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Adjust credits" }));
    expect(await screen.findByText(/amount above 0/)).toBeTruthy();
    expect(adjust).not.toHaveBeenCalled();
  });
});
