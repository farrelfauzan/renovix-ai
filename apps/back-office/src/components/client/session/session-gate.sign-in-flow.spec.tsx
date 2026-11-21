import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@/lib/api/create-api-client";
import { createPublicApiClient } from "@/lib/api/create-public-api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { createSessionApi } from "@/lib/session/session-api";
import { createSignInApi } from "@/lib/sign-in/sign-in-api";
import { SignInScreen } from "../sign-in/sign-in-screen";
import { SessionGate } from "./session-gate";

// RNX-286: a sign-in that starts on a gated route. The gate and the sign-in screen run together against one fake
// API whose answers follow its session cookie, and a fake router whose `replace` really changes the route, so the
// spec can assert where the admin ends up. The gate stays mounted across the navigation, as in the root layout.

const BASE_URL = "http://api.test";
const AUTH = `${BASE_URL}/api/v1/admin/auth`;
const EMAIL = "ops@example.com";
const PASSWORD = "correct horse battery staple";
const TOTP = "123456";
const SECRET = "JBSWY3DPEHPK3PXP";

let pathname = "/";
let rerenderApp: () => void = () => undefined;
/** Like the real router, `replace` changes the route after the caller's render or effect has finished. */
const replace = jest.fn((route: string) => {
  setTimeout(() => {
    pathname = route;
    act(() => rerenderApp());
  }, 0);
});
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => pathname }));

const fullProfile: AdminProfile = {
  id: "admin-1",
  name: "Ops",
  email: EMAIL,
  role: "owner",
  permissions: [],
  scope: "full",
  mfaEnrolled: true,
  mustChangePassword: false,
  idleExpiresAt: "2026-11-21T08:30:00.000Z",
  absoluteExpiresAt: "2026-11-21T20:00:00.000Z",
};

type Answer = { status: number; body?: unknown };

/** A fake API that holds the browser's session as the real one does through its cookies: none, enrolment or full. */
function createFakeApi(confirm: Answer) {
  let session: "none" | "enrolment" | "full" = "none";
  const answer = (url: string): Answer => {
    if (url === `${AUTH}/me`) return session === "none" ? { status: 401 } : { status: 200, body: { ...fullProfile, scope: session, mfaEnrolled: session === "full" } };
    if (url === `${AUTH}/refresh`) return { status: 401 };
    if (url === `${AUTH}/sign-in`) return (session = "enrolment"), { status: 200, body: { scope: "enrolment" } };
    if (url === `${AUTH}/totp/enrol`) return { status: 200, body: { secret: SECRET, otpauthUri: `otpauth://totp/x?secret=${SECRET}` } };
    if (url === `${AUTH}/totp/confirm`) return confirm.status === 200 ? ((session = "full"), confirm) : confirm;
    return { status: 404 };
  };
  const fetch = jest.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const { status, body } = answer(String(input));
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  const sessionClient = createApiClient({ baseUrl: BASE_URL, fetch, runExclusive: (task) => task() });
  return {
    sessionApi: createSessionApi(sessionClient),
    signInApi: createSignInApi(createPublicApiClient({ baseUrl: BASE_URL, fetch }), sessionClient),
    session: () => session,
  };
}

/** The app as the root layout builds it: one gate that stays mounted, the route's screen inside it. */
function renderApp(route: string, api: ReturnType<typeof createFakeApi>) {
  pathname = route;
  const app = () => (
    <SessionGate api={api.sessionApi} sideNavigation={<nav aria-label="Back-office" />} publicHeader={null}>
      {pathname === "/sign-in" ? <SignInScreen api={api.signInApi} /> : <p>Overview</p>}
    </SessionGate>
  );
  const view = render(app());
  rerenderApp = () => view.rerender(app());
  return view;
}

/** Password, "no authenticator yet", set one up, and the first code: up to the answer of totp/confirm. */
async function signInAndConfirmFirstCode() {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "No authenticator set up yet: continue without a code" }));
  fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
  fireEvent.change(await screen.findByLabelText("Code from your authenticator app"), { target: { value: TOTP } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
}

/** Lets pending answers and the redirects they cause settle. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));

describe("RNX-286: first sign-in that starts on a gated route", () => {
  beforeEach(() => replace.mockClear());

  it("AC1: signed out on \"/\", sent to sign-in, first MFA code confirmed: the admin lands on the overview, stays there, and is still there after a reload", async () => {
    const api = createFakeApi({ status: 200, body: { recoveryCodes: ["1111-2222-3333-4444"] } });
    const view = renderApp("/", api);
    await signInAndConfirmFirstCode();

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Overview")).toBeTruthy();
    await settle();
    expect(pathname).toBe("/");
    expect(replace.mock.calls.map(([route]) => route)).toEqual(["/sign-in", "/"]);
    expect(screen.getByRole("navigation", { name: "Back-office" })).toBeTruthy();
    view.unmount(); // a reload: a new gate, the same session
    renderApp("/", api);
    expect(await screen.findByText("Overview")).toBeTruthy();
    expect(pathname).toBe("/");
  });

  it("AC2: a wrong or expired first code stays on the MFA step with the API's message; no full session, and the route does not change", async () => {
    const api = createFakeApi({ status: 400, body: { statusCode: 400, message: "Invalid code", error: "Bad Request" } });
    renderApp("/", api);

    await signInAndConfirmFirstCode();

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid code");
    await settle();
    expect(screen.getByLabelText("Code from your authenticator app")).toBeTruthy();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(pathname).toBe("/sign-in");
    expect(api.session()).toBe("enrolment");
  });

  it("AC3: a signed-out visitor is still sent to sign-in from a gated route, also after visiting sign-in and going back without signing in", async () => {
    const api = createFakeApi({ status: 400 });
    renderApp("/audit-log", api);
    await screen.findByLabelText("Email");

    replace("/audit-log");

    await waitFor(() => expect(replace.mock.calls.map(([route]) => route)).toEqual(["/sign-in", "/audit-log", "/sign-in"]));
    await waitFor(() => expect(pathname).toBe("/sign-in"));
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
