import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { OfferVersion } from "@/lib/packages/offer-version";
import type { PackagesApi } from "@/lib/packages/packages-api";
import { RefusedError } from "@/lib/sign-in/refused-error";
import { ReauthRequiredError } from "@/lib/admins/reauth-required-error";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { CatalogSection } from "./catalog-section";

// RNX-98: the packages section against a fake of PackagesApi. The API's own rules (versions, audit, permissions) are tested in apps/api.

const version = (versionNumber: number, priceUsdCents: number): OfferVersion => ({
  id: `v${versionNumber}`, versionNumber, priceUsdCents, creditsGranted: "140.000000", billing: "monthly", maxAgents: 10, maxConnectedTools: 3,
  apiAccess: true, allowedChannels: ["web"], allowedTiers: ["standard"], effectiveFrom: "2020-01-01T00:00:00.000Z", createdBy: "admin", reason: "seed",
});
const pro = (versions = [version(1, 2500)]): CatalogOffer => ({ id: "pro", name: "Pro", active: true, visible: true, displayOrder: 2, versions });
const profile = (permissions: string[]): AdminProfile => ({ id: "a", email: "a@example.com", name: "a", role: "r", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true });
const sessionOf = (permissions: string[]): SessionApi => ({ me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined });
const READ = ["packages:read"];
const WRITE = ["packages:read", "packages:write"];

function createFakeApi(createVersion: PackagesApi["createVersion"]) {
  let offers = [pro()];
  const api: PackagesApi = {
    listOffers: async () => offers,
    createVersion: async (kind, id, input) => {
      await createVersion(kind, id, input);
      offers = [pro([version(2, Number(input.terms.priceUsdCents)), ...offers[0].versions])];
    },
    updateOffer: async () => undefined,
    getPriceList: async () => ({ rate: "16000", rateDate: "2026-10-21", source: "test", topUpPacks: [], packages: [{ name: "Pro", credits: 140, priceRupiah: 400000 }] }),
  };
  return api;
}

const renderSection = (api: PackagesApi, permissions: string[], reauth: () => Promise<void> = async () => undefined) => {
  render(<CatalogSection kind="package" title="Packages" api={api} sessionApi={sessionOf(permissions)} reauth={reauth} />);
};
const fillVersionForm = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "New version" }));
  fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "30.00" } });
  fireEvent.change(screen.getByLabelText("Reason (required, audited)"), { target: { value: "rate moved" } });
  fireEvent.click(screen.getByRole("button", { name: /Save as v2/ }));
};

describe("CatalogSection", () => {
  it("shows the new version and keeps the old one as history after a price change with a reason and a date", async () => {
    const create = jest.fn(async () => undefined);
    renderSection(createFakeApi(create), WRITE);
    await fillVersionForm();
    await waitFor(() => expect(screen.getByText("$30.00")).toBeTruthy());
    expect(create).toHaveBeenCalledWith("package", "pro", expect.objectContaining({ reason: "rate moved", effectiveFrom: expect.any(String), terms: expect.objectContaining({ priceUsdCents: 3000 }) }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const history = screen.getByRole("list", { name: "Versions of Pro" });
    expect(within(history).getByText(/\$25\.00/)).toBeTruthy();
    expect(within(history).getByText(/\$30\.00/)).toBeTruthy();
  });

  it("asks for re-authentication when the API requires it, then saves", async () => {
    let isReauthed = false;
    const create = jest.fn(async () => {
      if (!isReauthed) throw new ReauthRequiredError("Re-authentication required", 403);
    });
    renderSection(createFakeApi(create), WRITE, jest.fn(async () => { isReauthed = true; }));
    await fillVersionForm();
    const prompt = await screen.findByRole("dialog", { name: "Confirm it is you" });
    fireEvent.change(within(prompt).getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.change(within(prompt).getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(within(prompt).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByText("$30.00")).toBeTruthy());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("changes nothing and shows the message when the re-authentication is cancelled", async () => {
    const create = jest.fn(async () => { throw new ReauthRequiredError("Re-authentication required", 403); });
    renderSection(createFakeApi(create), WRITE);
    await fillVersionForm();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Confirm it is you" })).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Re-authentication was cancelled.")).toBeTruthy();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("hides the write controls from an admin without packages:write", async () => {
    renderSection(createFakeApi(jest.fn()), READ);
    await screen.findByText("Pro");
    expect(screen.queryByRole("button", { name: "New version" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Flags" })).toBeNull();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });

  it("shows the API's refusal as a message when a forced write is answered 403", async () => {
    const create = jest.fn(async () => { throw new RefusedError("Your role does not allow this (the API answered: Forbidden).", 403); });
    renderSection(createFakeApi(create), WRITE);
    await fillVersionForm();
    expect(await screen.findByText(/Your role does not allow this/)).toBeTruthy();
  });
});
