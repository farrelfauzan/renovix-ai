import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { PackagesApi } from "@/lib/packages/packages-api";
import type { CodesApi } from "@/lib/codes/codes-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { pickOption } from "@/test/pick-option";
import { CodesSection } from "./codes-section";

// RNX-291: the code form's "Grants" select, through the section against a fake of CodesApi.
// jsdom has no scrollIntoView, which the open Select list calls on its selected item.
Element.prototype.scrollIntoView = jest.fn();

const profile: AdminProfile = { id: "a", email: "a@example.com", name: "a", role: "r", permissions: ["packages:write"], scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z" };
const sessionApi: SessionApi = { me: async () => profile, changePassword: async () => undefined, signOut: async () => undefined };

const versionOf = (id: string, versionNumber: number, effectiveFrom: string) => ({ id, versionNumber, effectiveFrom, createdBy: "admin", reason: "seed", priceUsdCents: 2500 });
const starter: CatalogOffer = { id: "pkg-starter", name: "Starter", active: true, versions: [versionOf("ver-future", 2, "2999-01-01T00:00:00.000Z"), versionOf("ver-current", 1, "2020-01-01T00:00:00.000Z")] };
const packagesApiOf = (offers: readonly CatalogOffer[]): PackagesApi => ({ listOffers: async () => offers, createVersion: async () => undefined, updateOffer: async () => undefined, getPriceList: async () => { throw new Error("unused"); } });
const createCode = jest.fn(async () => undefined);
const codesApi: CodesApi = { listCodes: async () => ({ codes: [], total: 0, page: 1, limit: 25 }), createCode, deactivateCode: async () => undefined, listRedemptions: async () => [] };
const openForm = async (offers: readonly CatalogOffer[]) => {
  render(<CodesSection api={codesApi} packagesApi={packagesApiOf(offers)} sessionApi={sessionApi} reauth={async () => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Create code" }));
};

describe("CodesSection create form", () => {
  beforeEach(() => createCode.mockClear());
  it("creates the code with the type picked in the select and the id of the package version picked", async () => {
    await openForm([starter]);
    pickOption(screen.getByRole("combobox", { name: "Grants" }), "A plan");
    fireEvent.click(screen.getByRole("combobox", { name: "Package version" }));
    fireEvent.click(await screen.findByRole("option", { name: /Starter v1 · \$25\.00/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Create code" })[0]);
    await waitFor(() => expect(createCode).toHaveBeenCalled());
    expect(createCode).toHaveBeenCalledWith(expect.objectContaining({ type: "subscription", packageVersionId: "ver-current" }));
  });
  it("marks a version with a future effective date as scheduled and a current one not", async () => {
    await openForm([starter]);
    pickOption(screen.getByRole("combobox", { name: "Grants" }), "A plan");
    fireEvent.click(screen.getByRole("combobox", { name: "Package version" }));
    expect(await screen.findByRole("option", { name: /Starter v2 \(scheduled\)/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Starter v1/ }).textContent).not.toContain("scheduled");
  });
  it("cannot be submitted for a plan until a version is picked", async () => {
    await openForm([starter]);
    pickOption(screen.getByRole("combobox", { name: "Grants" }), "A plan");
    const submit = screen.getAllByRole("button", { name: "Create code" })[0];
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(createCode).not.toHaveBeenCalled();
  });
  it.each(["A plan", "Credits and a plan"])("says there are no package versions and sends nothing for Grants = %s", async (grants) => {
    await openForm([{ ...starter, versions: [] }]);
    pickOption(screen.getByRole("combobox", { name: "Grants" }), grants);
    expect(screen.getByText("No package versions yet")).toBeTruthy();
    const submit = screen.getAllByRole("button", { name: "Create code" })[0];
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(createCode).not.toHaveBeenCalled();
  });
});
