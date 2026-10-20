import { fireEvent, render, screen } from "@testing-library/react";
import { createApiClient } from "@/lib/api/create-api-client";
import { createPublicApiClient } from "@/lib/api/create-public-api-client";
import { createInvitationApi } from "@/lib/invitation/invitation-api";
import { createSignInApi } from "@/lib/sign-in/sign-in-api";
import { AcceptInvitationScreen } from "./accept-invitation-screen";

// RNX-207: completing an invitation against the real back-office clients over a mocked fetch (the RX-95 and RX-94 routes).

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const API = "http://api.test/api/v1/admin";
const PREVIEW = `${API}/invitations/preview`;
const ACCEPT = `${API}/invitations/accept`;
const ENROL = `${API}/auth/totp/enrol`;
const CONFIRM = `${API}/auth/totp/confirm`;
const TOKEN = "tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const NAME = "Rina Ops";
const PASSWORD = "a long and unusual passphrase 42";
const TOTP = "123456";
const SECRET = "JBSWY3DPEHPK3PXP";
const OTPAUTH_URI = `otpauth://totp/Renovix%20Admin:rina%40example.com?secret=${SECRET}&issuer=Renovix%20Admin`;
const RECOVERY_CODES = ["1111-2222-3333-4444", "5555-6666-7777-8888"];
const PREVIEW_BODY = { email: "rina@example.com", role: "operations", invitedBy: { name: "Owner One", email: "owner@example.com" }, expiresAt: "2026-10-28T08:00:00.000Z" };
const gone = (message: string) => ({ status: 410, body: { statusCode: 410, message, error: "Gone" } });

type Answer = { status: number; body?: unknown };

/** A fake API: one answer per URL; records every request's URL and body. */
function createMockApi(answers: Record<string, Answer>) {
  const fetch = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const { status, body } = answers[String(input)] ?? { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  const publicClient = createPublicApiClient({ baseUrl: "http://api.test", fetch });
  const sessionClient = createApiClient({ baseUrl: "http://api.test", fetch, runExclusive: (task) => task() });
  const sent = () => fetch.mock.calls.map(([url, init]) => ({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined }));
  return { invitationApi: createInvitationApi(publicClient), signInApi: createSignInApi(publicClient, sessionClient), sent };
}

function openLink(fragment = `#token=${TOKEN}`) {
  window.history.replaceState(null, "", `/accept-invitation${fragment}`);
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: NAME } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

const FULL_FLOW = {
  [PREVIEW]: { status: 200, body: PREVIEW_BODY },
  [ACCEPT]: { status: 200, body: { scope: "enrolment" } },
  [ENROL]: { status: 200, body: { secret: SECRET, otpauthUri: OTPAUTH_URI } },
  [CONFIRM]: { status: 200, body: { recoveryCodes: RECOVERY_CODES } },
};

async function completeFlow() {
  fillAndSubmit();
  fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
  fireEvent.change(await screen.findByLabelText("Code from your authenticator app"), { target: { value: TOTP } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await screen.findByRole("list", { name: "Recovery codes" });
}

describe("AcceptInvitationScreen (RNX-207)", () => {
  beforeEach(() => {
    replace.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shows who invited and the role, the email read-only; password, then TOTP, then the recovery codes, then the overview", async () => {
    const mock = createMockApi(FULL_FLOW);
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);

    expect(await screen.findByText(/Owner One \(owner@example\.com\) invited you/)).toBeTruthy();
    expect(screen.getByText("operations")).toBeTruthy();
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect([email.value, email.readOnly]).toEqual(["rina@example.com", true]);
    fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(screen.getByText(OTPAUTH_URI)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Code from your authenticator app"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const codes = await screen.findByRole("list", { name: "Recovery codes" });
    expect(Array.from(codes.querySelectorAll("li"), (li) => li.textContent)).toEqual(RECOVERY_CODES);
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(replace).toHaveBeenCalledWith("/");
    expect(mock.sent()).toEqual([
      { url: PREVIEW, body: { token: TOKEN } },
      { url: ACCEPT, body: { token: TOKEN, name: NAME, password: PASSWORD } },
      { url: ENROL, body: undefined },
      { url: CONFIRM, body: { code: TOTP } },
    ]);
  });

  it("does not land anywhere before the TOTP enrolment: after the password only the enrolment step is shown", async () => {
    const mock = createMockApi(FULL_FLOW);
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    await screen.findByLabelText("Name");

    fillAndSubmit();

    expect(await screen.findByRole("button", { name: "Set up authenticator" })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("the token goes only in the POST bodies of preview and accept: in no URL, no other body, no browser storage, not left in the address bar", async () => {
    const mock = createMockApi(FULL_FLOW);
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    await screen.findByLabelText("Name");
    expect(window.location.href).not.toContain(TOKEN);

    await completeFlow();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const requests = mock.sent();
    expect(requests.filter(({ url }) => url.includes(TOKEN))).toEqual([]);
    expect(requests.filter(({ body }) => JSON.stringify(body ?? null).includes(TOKEN)).map(({ url }) => url)).toEqual([PREVIEW, ACCEPT]);
    const stored = [window.localStorage, window.sessionStorage].flatMap((storage) => Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`));
    expect(stored.join("\n")).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it.each([
    ["used", gone("This invitation link has already been used")],
    ["revoked", gone("This invitation link has been revoked")],
    ["expired", gone("This invitation link has expired")],
    ["unknown", { status: 404, body: { statusCode: 404, message: "Invitation not found", error: "Not Found" } }],
  ])("a %s link: the API's message, no form, no accept call, no navigation", async (_kind, answer) => {
    const mock = createMockApi({ ...FULL_FLOW, [PREVIEW]: answer });
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);

    expect((await screen.findByRole("alert")).textContent).toBe((answer.body as { message: string }).message);
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(mock.sent().map(({ url }) => url)).toEqual([PREVIEW]);
    expect(replace).not.toHaveBeenCalled();
  });

  it("a link used meanwhile (accept answers 410): the API's message, no enrolment, no navigation", async () => {
    const mock = createMockApi({ ...FULL_FLOW, [ACCEPT]: gone("This invitation link is no longer valid") });
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    await screen.findByLabelText("Name");

    fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toBe("This invitation link is no longer valid");
    expect(screen.queryByRole("button", { name: "Set up authenticator" })).toBeNull();
    expect(mock.sent().map(({ url }) => url)).toEqual([PREVIEW, ACCEPT]);
    expect(replace).not.toHaveBeenCalled();
  });

  it("a password the API refuses (400): its message, and the form stays", async () => {
    const mock = createMockApi({ ...FULL_FLOW, [ACCEPT]: { status: 400, body: { statusCode: 400, message: "This password is too common", error: "Bad Request" } } });
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    await screen.findByLabelText("Name");

    fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toBe("This password is too common");
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a link without a token: a message, and nothing is sent", async () => {
    const mock = createMockApi(FULL_FLOW);
    openLink("");
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/not complete/);
    expect(mock.sent()).toEqual([]);
  });

  it("the inputs carry the password-manager hints: username (read-only email), new-password, one-time-code", async () => {
    const mock = createMockApi(FULL_FLOW);
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    await screen.findByLabelText("Name");

    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    expect((await screen.findByLabelText("Code from your authenticator app")).getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("logs nothing: no token, password, TOTP code, secret or recovery code reaches the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => jest.spyOn(console, method));
    const mock = createMockApi(FULL_FLOW);
    openLink();
    render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    await screen.findByLabelText("Name");

    await completeFlow();

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of [TOKEN, PASSWORD, TOTP, SECRET, ...RECOVERY_CODES]) expect(logged).not.toContain(secret);
    spies.forEach((spy) => spy.mockRestore());
  });
});
