import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createApiClient } from "@/lib/api/create-api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { createSessionApi } from "@/lib/session/session-api";
import { SessionFooter } from "./session-footer";
import { SessionGate } from "./session-gate";

// RNX-312a AC3: the session footer inside the real session gate and session client, over a mocked fetch.

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/admins-and-roles" }));

const ME = "http://api.test/api/v1/admin/auth/me";
const SIGN_OUT = "http://api.test/api/v1/admin/auth/sign-out";
const MINUTE = 60_000;
const START = new Date("2026-10-14T08:00:00.000Z");

const profile = (overrides: Partial<AdminProfile> = {}): AdminProfile => ({
  id: "admin-1",
  name: "Farrel A.",
  email: "farrel@example.com",
  role: "owner",
  permissions: ["audit:read"],
  scope: "full",
  mfaEnrolled: true,
  mustChangePassword: false,
  idleExpiresAt: new Date(START.getTime() + 30 * MINUTE).toISOString(),
  absoluteExpiresAt: new Date(START.getTime() + 12 * 60 * MINUTE).toISOString(),
  ...overrides,
});

type Answer = { status: number; body?: unknown };

/** The gate with the footer as its shell, on a fake API (one answer per URL); records every "METHOD url" fetched. */
function renderShell(answers: Record<string, Answer>) {
  const fetch = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const { status, body } = answers[String(input)] ?? { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  const api = createSessionApi(createApiClient({ baseUrl: "http://api.test", fetch, runExclusive: (task) => task() }));
  render(
    <SessionGate api={api} sideNavigation={<SessionFooter api={api} />} publicHeader={null}>
      <p>Gated content</p>
    </SessionGate>,
  );
  return { calls: () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`) };
}

describe("SessionFooter (RNX-312a)", () => {
  beforeEach(() => {
    replace.mockClear();
    jest.useFakeTimers({ now: START });
  });

  afterEach(() => jest.useRealTimers());

  it("AC3: initials, name, role and MFA state; the idle time counts down from the /me answer with no further /me call", async () => {
    const shell = renderShell({ [ME]: { status: 200, body: profile() } });

    const footer = await screen.findByRole("group", { name: "Session" });
    expect(within(footer).getByText("FA")).toBeTruthy();
    expect(within(footer).getByText("Farrel A.")).toBeTruthy();
    expect(footer.textContent).toContain("owner · MFA on");
    expect(footer.textContent).toContain("Session idle in 30 min");
    act(() => jest.advanceTimersByTime(5 * MINUTE));
    expect(footer.textContent).toContain("Session idle in 25 min");
    act(() => jest.advanceTimersByTime(24 * MINUTE + 30_000));
    expect(footer.textContent).toContain("Session idle in under 1 min");
    expect(shell.calls()).toEqual([`GET ${ME}`]);
  });

  it("MFA off for an admin without TOTP; the email when there is no name", async () => {
    renderShell({ [ME]: { status: 200, body: profile({ mfaEnrolled: false, name: null }) } });

    const footer = await screen.findByRole("group", { name: "Session" });
    expect(footer.textContent).toContain("owner · MFA off");
    expect(within(footer).getByText("farrel@example.com")).toBeTruthy();
    expect(within(footer).getByText("F")).toBeTruthy();
  });

  it("Sign out sends the sign-out request, then sign-in", async () => {
    const shell = renderShell({ [ME]: { status: 200, body: profile() }, [SIGN_OUT]: { status: 204 } });

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(shell.calls()).toEqual([`GET ${ME}`, `POST ${SIGN_OUT}`]);
  });

  it("a sign-out the API refuses: its message, and no navigation", async () => {
    renderShell({ [ME]: { status: 200, body: profile() }, [SIGN_OUT]: { status: 500, body: { statusCode: 500, message: "Internal server error" } } });

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Internal server error");
    expect(replace).not.toHaveBeenCalled();
  });
});
