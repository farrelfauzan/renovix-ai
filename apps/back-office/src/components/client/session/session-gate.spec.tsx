import { render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@/lib/api/create-api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { createSessionApi } from "@/lib/session/session-api";
import { SessionGate } from "./session-gate";

// RNX-207: the route gate against the real session client (shared refresh) over a mocked fetch.

const replace = jest.fn();
let pathname = "/";
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => pathname }));

const ME = "http://api.test/api/v1/admin/auth/me";
const REFRESH = "http://api.test/api/v1/admin/auth/refresh";
const GATED_ROUTES = ["/", "/audit-log", "/admins-and-roles", "/settings", "/change-password"];

const profile = (overrides: Partial<AdminProfile> = {}): AdminProfile => ({
  id: "admin-1",
  name: "Ops",
  email: "ops@example.com",
  role: "owner",
  permissions: ["audit:read"],
  scope: "full",
  mfaEnrolled: true,
  mustChangePassword: false,
  ...overrides,
});

type Answer = { status: number; body?: unknown };

/** A fake API: one answer per URL (unknown URLs: 404); records every URL fetched. */
function createSession(answers: Record<string, Answer>) {
  const fetch = jest.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const { status, body } = answers[String(input)] ?? { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  const api = createSessionApi(createApiClient({ baseUrl: "http://api.test", fetch, runExclusive: (task) => task() }));
  return { api, urls: () => fetch.mock.calls.map(([url]) => String(url)) };
}

function renderGate(route: string, answers: Record<string, Answer>) {
  pathname = route;
  const session = createSession(answers);
  render(
    <SessionGate api={session.api} sideNavigation={<nav aria-label="Back-office" />}>
      <p>Gated content</p>
    </SessionGate>,
  );
  return session;
}

/** The API's answers without a session cookie: 401 on /me, and the refresh fails too. */
const NO_SESSION = { [ME]: { status: 401 }, [REFRESH]: { status: 401 } };

describe("SessionGate (RNX-207)", () => {
  beforeEach(() => replace.mockClear());

  it.each(GATED_ROUTES)("no session: %s lands on sign-in and renders nothing of the route", async (route) => {
    const session = renderGate(route, NO_SESSION);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(screen.queryByText("Gated content")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(session.urls()).toEqual([ME, REFRESH]);
  });

  it.each(["/", "/audit-log", "/settings"])("with a full session %s renders, with the side navigation (control)", async (route) => {
    renderGate(route, { [ME]: { status: 200, body: profile() } });

    expect(await screen.findByText("Gated content")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Back-office" })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a suspended admin (me 401, the refresh 401 too): no gated route renders, sign-in instead", async () => {
    renderGate("/audit-log", { [ME]: { status: 401, body: { statusCode: 401, message: "Authentication required" } }, [REFRESH]: { status: 401 } });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(screen.queryByText("Gated content")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("the API cannot answer (500): nothing of the route renders, a message instead", async () => {
    renderGate("/", { [ME]: { status: 500 } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be checked/);
    expect(screen.queryByText("Gated content")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["/sign-in", "/accept-invitation"])("%s is never gated: no call to the API, no redirect, no side navigation", async (route) => {
    const session = renderGate(route, NO_SESSION);

    expect(screen.getByText("Gated content")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session.urls()).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each(GATED_ROUTES)("an invitee who has not enrolled TOTP yet (enrolment session) reaches nothing: %s goes to sign-in", async (route) => {
    renderGate(route, { [ME]: { status: 200, body: profile({ scope: "enrolment", mfaEnrolled: false }) } });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(screen.queryByText("Gated content")).toBeNull();
  });

  it.each(["/", "/audit-log", "/admins-and-roles", "/settings"])("forced password change: %s goes to the change-password screen and does not render", async (route) => {
    renderGate(route, { [ME]: { status: 200, body: profile({ scope: "password_change", mustChangePassword: true }) } });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/change-password"));
    expect(screen.queryByText("Gated content")).toBeNull();
  });

  it("forced password change: the change-password screen renders, without the side navigation", async () => {
    renderGate("/change-password", { [ME]: { status: 200, body: profile({ scope: "password_change", mustChangePassword: true }) } });

    expect(await screen.findByText("Gated content")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("after the change (full session): the change-password screen sends to the overview", async () => {
    renderGate("/change-password", { [ME]: { status: 200, body: profile() } });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("Gated content")).toBeNull();
  });
});
