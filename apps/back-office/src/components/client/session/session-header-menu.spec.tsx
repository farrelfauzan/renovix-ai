import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@/lib/api/create-api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { createSessionApi } from "@/lib/session/session-api";
import { SessionFooter } from "./session-footer";
import { SessionGate } from "./session-gate";
import { SessionHeaderMenu } from "./session-header-menu";

// RNX-312a AC5: the collapsed shell's header menu inside the real session gate and session client, over a mocked
// fetch. jsdom applies no CSS, so the 760 px breakpoint is checked as the classes that hide each part; the menu's
// behaviour is fired and asserted.

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/admins-and-roles" }));

// jsdom has no ResizeObserver, which the open menu's positioning uses.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const ME = "http://api.test/api/v1/admin/auth/me";
const SIGN_OUT = "http://api.test/api/v1/admin/auth/sign-out";
const MINUTE = 60_000;

const profile = (): AdminProfile => ({
  id: "admin-1", name: "Farrel A.", email: "farrel@example.com", role: "owner", permissions: [], scope: "full", mfaEnrolled: true, mustChangePassword: false,
  idleExpiresAt: new Date(Date.now() + 28 * MINUTE).toISOString(), absoluteExpiresAt: new Date(Date.now() + 12 * 60 * MINUTE).toISOString(),
});

/** The gate with the header menu and the footer as its shell; records every "METHOD url" fetched. */
function renderShell() {
  const fetch = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === ME) return { ok: true, status: 200, json: async () => profile() } as Response;
    if (url === SIGN_OUT) return { ok: true, status: 204, json: async () => null } as Response;
    return { ok: false, status: 404, json: async () => null } as Response;
  });
  const api = createSessionApi(createApiClient({ baseUrl: "http://api.test", fetch, runExclusive: (task) => task() }));
  render(
    <SessionGate api={api} sideNavigation={<aside><SessionHeaderMenu api={api} /><SessionFooter api={api} /></aside>} publicHeader={null}>
      <p>Gated content</p>
    </SessionGate>,
  );
  return { calls: () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`) };
}

describe("SessionHeaderMenu (RNX-312a)", () => {
  beforeEach(() => replace.mockClear());

  it("AC5: at 760 px or less the footer is hidden and the header menu shows; above, the reverse", async () => {
    renderShell();

    const trigger = await screen.findByRole("button", { name: "Session menu" });
    expect(trigger.parentElement?.className).toContain("wide:hidden");
    expect(screen.getByRole("group", { name: "Session" }).className).toContain("narrow:hidden");
  });

  it("AC5: the header menu holds the idle time and Sign out; choosing Sign out sends the sign-out request, then sign-in", async () => {
    const shell = renderShell();

    fireEvent.keyDown(await screen.findByRole("button", { name: "Session menu" }), { key: "Enter" });

    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toContain("Session idle in 28 min");
    expect(menu.textContent).toContain("owner · MFA on");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(shell.calls()).toEqual([`GET ${ME}`, `POST ${SIGN_OUT}`]);
  });
});
