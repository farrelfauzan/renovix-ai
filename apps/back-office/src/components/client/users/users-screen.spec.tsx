import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { PackagesApi } from "@/lib/packages/packages-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { RefusedError } from "@/lib/sign-in/refused-error";
import type { UserDetail } from "@/lib/users/user-detail";
import type { UserListItem } from "@/lib/users/user-list-item";
import type { UserListPage } from "@/lib/users/user-list-page";
import type { UserListQuery } from "@/lib/users/user-list-query";
import type { UserReveal } from "@/lib/users/user-reveal";
import type { UserRevealInput } from "@/lib/users/user-reveal-input";
import { createUsersApi, type UsersApi } from "@/lib/users/users-api";
import { pickOption } from "@/test/pick-option";
import { UsersScreen } from "./users-screen";

// RNX-358: the users screen against fake UsersApi / PackagesApi / SessionApi objects (shapes from apps/api admin-users
// types). Each user action is fired and the argument the fake API received is asserted. Made-up values only.

// jsdom has no scrollIntoView, which the open Select list calls on its selected item.
Element.prototype.scrollIntoView = jest.fn();

const SECRET_EMAIL = "rahasia.pribadi@example.com";
const REASON = "ticket 5120: account question";
const OPERATIONS = ["users:read", "users:read_pii", "credits:read", "packages:read"];
const SUPPORT = ["users:read"];

const profile = (permissions: string[]): AdminProfile => ({
  id: "admin-1", name: "Ops", email: "ops@example.com", role: "custom", permissions, scope: "full", mfaEnrolled: true, mustChangePassword: false, idleExpiresAt: "2026-11-25T08:30:00.000Z", absoluteExpiresAt: "2026-11-25T20:00:00.000Z",
});
/** A user whose paid wallet has balance 100 and 30 held: the API lists 70 available. */
const AVAILABLE_70: UserListItem = {
  id: "user-70", email: "***", name: "***", package: { id: "pkg-pro", name: "Pro" }, creditsAvailable: "70", status: "active", lastLoginAt: "2026-11-20T08:00:00.000Z",
};
/** A user whose paid wallet has balance 5 and 5 held: 0 available, locked. */
const AVAILABLE_0: UserListItem = { id: "user-0", email: "***", name: null, package: null, creditsAvailable: "0", status: "locked", lastLoginAt: null };
const detailOf = (overrides: Partial<UserDetail> = {}): UserDetail => ({
  ...AVAILABLE_70, phone: "***", joinedAt: "2026-09-12T00:00:00.000Z", timezone: "Asia/Jakarta", language: "id", signInMethods: ["credential", "google"], ledger: null, ...overrides,
});
const PACKAGES: CatalogOffer[] = [{ id: "pkg-pro", name: "Pro", active: true, versions: [] }, { id: "pkg-starter", name: "Starter", active: true, versions: [] }];

type FakeOptions = { readonly hasMore?: boolean; readonly detail?: UserDetail; readonly reveal?: (id: string, input: UserRevealInput) => Promise<UserReveal> };

/** A fake UsersApi that records every call. */
const createFakeApi = ({ hasMore = false, detail = detailOf(), reveal = async (_id, input) => ({ field: input.field, value: SECRET_EMAIL }) }: FakeOptions = {}) => ({
  listUsers: jest.fn(async (query: UserListQuery): Promise<UserListPage> => ({ page: query.page, pageSize: 50, hasMore, items: [AVAILABLE_70, AVAILABLE_0] })),
  getUser: jest.fn(async (): Promise<UserDetail> => detail),
  revealField: jest.fn(reveal),
});
const createPackagesApi = () => ({
  listOffers: jest.fn(async () => PACKAGES),
  createVersion: async () => undefined,
  updateOffer: async () => undefined,
  getPriceList: async () => {
    throw new Error("unused");
  },
});

const renderScreen = (permissions: string[], api: UsersApi = createFakeApi(), packagesApi: PackagesApi = createPackagesApi()) => {
  const sessionApi: SessionApi = { me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined };
  render(<UsersScreen api={api} packagesApi={packagesApi} sessionApi={sessionApi} />);
};
const listed = async () => screen.findByRole("button", { name: "Open user user-70" });
const openUser = async (id = "user-70") => {
  fireEvent.click(await screen.findByRole("button", { name: `Open user ${id}` }));
  return screen.findByRole("region", { name: `User ${id}` });
};
const askReveal = async (label: string, reason: string) => {
  fireEvent.click(await screen.findByRole("button", { name: `Reveal ${label}` }));
  const form = screen.getByRole("form", { name: `Reveal ${label}` });
  fireEvent.change(within(form).getByRole("textbox", { name: "Reason" }), { target: { value: reason } });
  return form;
};

describe("UsersScreen (RNX-358)", () => {
  describe("AC2: search, filters and paging each send exactly the expected list request", () => {
    it("search by email: nothing is sent while typing; Enter sends { email } trimmed, page 1", async () => {
      const api = createFakeApi();
      renderScreen(SUPPORT, api);
      await listed();
      const input = screen.getByRole("searchbox", { name: "Exact email or user id" });
      for (const text of ["b", "bu", "  Budi.Santoso@example.com  "]) fireEvent.change(input, { target: { value: text } });
      expect(api.listUsers).toHaveBeenCalledTimes(1);
      fireEvent.submit(screen.getByRole("search", { name: "Find users" }));
      await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(2));
      expect(api.listUsers).toHaveBeenLastCalledWith({ email: "Budi.Santoso@example.com", page: 1 });
    });

    it("search by id: the Search button sends { id }, page 1", async () => {
      const api = createFakeApi();
      renderScreen(SUPPORT, api);
      await listed();
      fireEvent.change(screen.getByRole("searchbox", { name: "Exact email or user id" }), { target: { value: " user-70 " } });
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(2));
      expect(api.listUsers).toHaveBeenLastCalledWith({ id: "user-70", page: 1 });
    });

    it("the first load asks for page 1 with no filter", async () => {
      const api = createFakeApi();
      renderScreen(SUPPORT, api);
      await listed();
      expect(api.listUsers.mock.calls).toEqual([[{ page: 1 }]]);
    });

    it("Next sends page 2 (hasMore), Previous is off on page 1; a status filter then goes back to page 1", async () => {
      const api = createFakeApi({ hasMore: true });
      renderScreen(SUPPORT, api);
      await listed();
      expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith({ page: 2 }));
      await screen.findByText("Page 2");
      pickOption(screen.getByRole("combobox", { name: "Status" }), "Locked (no available credits)");
      await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith({ status: "locked", page: 1 }));
      expect(api.listUsers).toHaveBeenCalledTimes(3);
    });

    it("Next is off when the API says there is no more", async () => {
      renderScreen(SUPPORT, createFakeApi({ hasMore: false }));
      await listed();
      expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("with packages:read, the package filter lists the packages and sends { packageId }, page 1", async () => {
      const api = createFakeApi();
      const packagesApi = createPackagesApi();
      renderScreen(OPERATIONS, api, packagesApi);
      await listed();
      pickOption(await screen.findByRole("combobox", { name: "Package" }), "Starter");
      await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith({ packageId: "pkg-starter", page: 1 }));
      expect(packagesApi.listOffers).toHaveBeenCalledWith("package");
    });

    it("without packages:read, there is no package filter and the packages are not requested", async () => {
      const packagesApi = createPackagesApi();
      renderScreen(SUPPORT, createFakeApi(), packagesApi);
      await listed();
      expect(screen.queryByRole("combobox", { name: "Package" })).toBeNull();
      expect(packagesApi.listOffers).not.toHaveBeenCalled();
    });
  });

  describe("AC3 / AC4: the credits figure is the API's available credits", () => {
    it("AC3: the list shows 70 for balance 100 with 30 held, and 0 with locked for balance 5 with 5 held", async () => {
      renderScreen(SUPPORT);
      const row70 = (await listed()).closest("tr") as HTMLElement;
      const row0 = screen.getByRole("button", { name: "Open user user-0" }).closest("tr") as HTMLElement;
      expect(screen.getByRole("columnheader", { name: "Available credits" })).toBeTruthy();
      expect(within(row70).getByText("70")).toBeTruthy();
      expect(within(row0).getByText("0")).toBeTruthy();
      expect(within(row0).getByText("locked")).toBeTruthy();
    });

    it("AC4: the detail panel shows 70 as the available credits", async () => {
      renderScreen(SUPPORT);
      const panel = await openUser();
      const term = await within(panel).findByText("Available credits");
      expect(term.nextElementSibling?.textContent).toBe("70");
    });
  });

  describe("the detail", () => {
    it("opening a user loads its detail once", async () => {
      const api = createFakeApi();
      renderScreen(SUPPORT, api);
      const panel = await openUser();
      await within(panel).findByText("Personal data");
      expect(api.getUser.mock.calls).toEqual([["user-70"]]);
    });

    it("no Ledger tab when the API sent ledger null (no credits:read)", async () => {
      renderScreen(SUPPORT);
      const panel = await openUser();
      expect(await within(panel).findByRole("tab", { name: "Overview" })).toBeTruthy();
      expect(within(panel).queryByRole("tab", { name: "Ledger" })).toBeNull();
    });

    it("a Ledger tab with the entries when the API sent a ledger", async () => {
      const ledger = [{ id: "e1", wallet: "paid", type: "bonus", amount: "25", balanceAfter: "100", createdAt: "2026-11-20T08:00:00.000Z" }];
      renderScreen(OPERATIONS, createFakeApi({ detail: detailOf({ ledger }) }));
      const panel = await openUser();
      fireEvent.mouseDown(await within(panel).findByRole("tab", { name: "Ledger" }));
      const table = await within(panel).findByRole("table");
      expect(within(table).getByText("bonus")).toBeTruthy();
      expect(within(table).getByText("25")).toBeTruthy();
    });
  });

  describe("AC2: the reveal", () => {
    it("asks for a reason, sends { field, reason } once and shows the value in the panel", async () => {
      const api = createFakeApi();
      renderScreen(OPERATIONS, api);
      const panel = await openUser();
      const form = await askReveal("email", `  ${REASON}  `);
      expect(api.revealField).not.toHaveBeenCalled();
      fireEvent.click(within(form).getByRole("button", { name: "Reveal email" }));
      expect(await within(panel).findByText(SECRET_EMAIL)).toBeTruthy();
      expect(api.revealField.mock.calls).toEqual([["user-70", { field: "email", reason: REASON }]]);
    });

    it("an empty or blank reason sends nothing", async () => {
      const api = createFakeApi();
      renderScreen(OPERATIONS, api);
      await openUser();
      const form = await askReveal("phone", "   ");
      const submit = within(form).getByRole("button", { name: "Reveal phone" }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      fireEvent.submit(form);
      fireEvent.change(within(form).getByRole("textbox", { name: "Reason" }), { target: { value: "" } });
      fireEvent.submit(form);
      expect(api.revealField).not.toHaveBeenCalled();
    });

    it("a 403 shows the API's message (through the real client, POST with the reason in the body)", async () => {
      const request = jest.fn(async (_path: string, _init?: RequestInit): Promise<Response> => ({ ok: false, status: 403, json: async () => ({ statusCode: 403, message: "Forbidden" }) }) as Response);
      const realApi = createUsersApi({ request } as ApiClient);
      const api: UsersApi = { ...createFakeApi(), revealField: realApi.revealField };
      renderScreen(SUPPORT, api);
      const panel = await openUser();
      fireEvent.click(within(await askReveal("name", REASON)).getByRole("button", { name: "Reveal name" }));
      expect((await within(panel).findByRole("alert")).textContent).toBe("Your role does not allow this (the API answered: Forbidden).");
      expect(request).toHaveBeenCalledWith("/api/v1/admin/users/user-70/reveal", expect.objectContaining({ method: "POST", body: JSON.stringify({ field: "name", reason: REASON }) }));
    });

    it("a 400 shows the API's message", async () => {
      const api = createFakeApi({ reveal: async () => Promise.reject(new RefusedError("Invalid request body", 400)) });
      renderScreen(OPERATIONS, api);
      const panel = await openUser();
      fireEvent.click(within(await askReveal("email", REASON)).getByRole("button", { name: "Reveal email" }));
      expect((await within(panel).findByRole("alert")).textContent).toBe("Invalid request body");
      expect(within(panel).queryByText(SECRET_EMAIL)).toBeNull();
    });

    it("the revealed value is gone once the panel closes and the user is opened again", async () => {
      renderScreen(OPERATIONS);
      const panel = await openUser();
      fireEvent.click(within(await askReveal("email", REASON)).getByRole("button", { name: "Reveal email" }));
      await within(panel).findByText(SECRET_EMAIL);
      fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
      const reopened = await openUser();
      await within(reopened).findByText("Personal data");
      expect(screen.queryByText(SECRET_EMAIL)).toBeNull();
    });

    it("the revealed value is not written to storage, the URL or the console", async () => {
      const setItem = jest.spyOn(Storage.prototype, "setItem");
      const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => jest.spyOn(console, method));
      renderScreen(OPERATIONS);
      const panel = await openUser();
      fireEvent.click(within(await askReveal("email", REASON)).getByRole("button", { name: "Reveal email" }));
      await within(panel).findByText(SECRET_EMAIL);
      expect(setItem).not.toHaveBeenCalled();
      expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET_EMAIL);
      expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET_EMAIL);
      expect(window.location.href).not.toContain("rahasia");
      expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(SECRET_EMAIL);
      setItem.mockRestore();
      consoleSpies.forEach((spy) => spy.mockRestore());
    });
  });

  describe("the masking banner (visibility only)", () => {
    it("a role without users:read_pii sees the banner, and still sees the Reveal buttons", async () => {
      renderScreen(SUPPORT);
      expect(await screen.findByText("Personal data masked for your role")).toBeTruthy();
      const panel = await openUser();
      expect(await within(panel).findByRole("button", { name: "Reveal email" })).toBeTruthy();
    });

    it("a role with users:read_pii sees no banner", async () => {
      renderScreen(OPERATIONS);
      await listed();
      expect(screen.queryByText("Personal data masked for your role")).toBeNull();
    });

    it("a role without users:read gets a message and no list request", async () => {
      const api = createFakeApi();
      renderScreen(["usage:read"], api);
      expect(await screen.findByText("Your role has no access to users.")).toBeTruthy();
      expect(api.listUsers).not.toHaveBeenCalled();
    });
  });
});
