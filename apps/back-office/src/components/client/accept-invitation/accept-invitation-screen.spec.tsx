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
const EXPIRES_AT = "2026-10-28T08:00:00.000Z";
const PREVIEW_BODY = {
  email: "rina@example.com",
  role: "operations",
  invitedBy: { name: "Owner One", email: "owner@example.com", role: "owner" },
  expiresAt: EXPIRES_AT,
  sentAt: "2026-10-25T08:03:00.000Z",
};
const BREACHED = "This password is on a list of breached passwords. Choose another one.";
const SAVED = /I have saved these codes somewhere safe\. I understand they will not be shown again\./;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
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
  fireEvent.change(await screen.findByLabelText("Authenticator code"), { target: { value: TOTP } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm authenticator" }));
  await screen.findByRole("list", { name: "Recovery codes" });
}

/** The step the stepper marks as current (RNX-333). */
const currentStep = () => screen.getByRole("navigation", { name: "Setup progress" }).querySelector("[aria-current='step']")?.textContent;

/** RNX-333: the recovery codes' Finish is enabled only once "saved" is ticked. */
function finishRecoveryCodes() {
  fireEvent.click(screen.getByRole("checkbox", { name: SAVED }));
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
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

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("You were invited by Owner One");
    expect(screen.getByText("operations")).toBeTruthy();
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect([email.value, email.readOnly]).toEqual(["rina@example.com", true]);
    fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    await screen.findByText("Cannot scan? Enter this key by hand");
    expect(screen.getByText("Cannot scan? Enter this key by hand").nextElementSibling?.querySelector("code")?.textContent).toBe(SECRET);
    expect(screen.getByText(OTPAUTH_URI)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm authenticator" }));
    const codes = await screen.findByRole("list", { name: "Recovery codes" });
    expect(Array.from(codes.querySelectorAll("li"), (li) => li.textContent)).toEqual(RECOVERY_CODES);
    expect(replace).not.toHaveBeenCalled();
    finishRecoveryCodes();

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
    finishRecoveryCodes();

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
    expect((await screen.findByLabelText("Authenticator code")).getAttribute("autocomplete")).toBe("one-time-code");
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

describe("AcceptInvitationScreen as the Invite artboard (RNX-333)", () => {
  beforeEach(() => {
    replace.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => jest.restoreAllMocks());

  const renderScreen = (answers: Record<string, Answer> = FULL_FLOW) => {
    const mock = createMockApi(answers);
    openLink();
    const view = render(<AcceptInvitationScreen invitationApi={mock.invitationApi} signInApi={mock.signInApi} />);
    return { ...mock, view };
  };

  it("the inviter card: the inviter's name, role name and sent date, the invitee's email and role, and no role summary", async () => {
    renderScreen();

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("You were invited by Owner One");
    expect(screen.getByText(/· sent /).textContent).toMatch(/^owner · sent 25 Oct 2026, \d{2}:\d{2} \S+$/);
    expect(screen.getByText("Your email").nextElementSibling?.textContent).toBe("rina@example.com");
    expect(screen.getByText("Role").nextElementSibling?.textContent).toBe("operations");
    expect(screen.queryByText(/^Can/)).toBeNull();
  });

  it("an inviter without a name (made by the create-admin script): the card names their email", async () => {
    renderScreen({ ...FULL_FLOW, [PREVIEW]: { status: 200, body: { ...PREVIEW_BODY, invitedBy: { ...PREVIEW_BODY.invitedBy, name: null } } } });

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("You were invited by owner@example.com");
  });

  it("one step at a time: the stepper marks Password, then Authenticator, then Recovery codes, with the done steps ticked", async () => {
    renderScreen();
    await screen.findByLabelText("Name");

    expect(currentStep()).toBe("1Password");
    expect(screen.queryByRole("button", { name: "Set up authenticator" })).toBeNull();
    fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    expect(currentStep()).toBe("2Authenticator");
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getAllByLabelText("done")).toHaveLength(1);
    fireEvent.change(await screen.findByLabelText("Authenticator code"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm authenticator" }));
    await screen.findByRole("list", { name: "Recovery codes" });

    expect(currentStep()).toBe("3Recovery codes");
    expect(screen.getAllByLabelText("done")).toHaveLength(2);
    expect(screen.queryByText("Cannot scan? Enter this key by hand")).toBeNull();
  });

  it("the header gives the link's time left from the preview's expiry while it is unused, and drops it once the link is used", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse(EXPIRES_AT) - 70 * HOUR_MS - 12 * MINUTE_MS - 30_000);
    renderScreen();

    expect(await screen.findByText("Invitation link, single use, expires in 70 h 12 min")).toBeTruthy();
    fillAndSubmit();
    await screen.findByRole("button", { name: "Set up authenticator" });

    expect(screen.queryByText(/Invitation link, single use/)).toBeNull();
  });

  it("AC2: on the recovery-code step Finish is disabled until \"saved\" is ticked; nothing navigates before", async () => {
    renderScreen();
    await screen.findByLabelText("Name");
    await completeFlow();
    const finish = screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement;

    fireEvent.click(finish);
    expect(finish.disabled).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: SAVED }));
    fireEvent.click(finish);

    expect(replace).toHaveBeenCalledWith("/");
  });

  it("AC5: typing the password shows only the length feedback and sends no request; a breached password is refused at submit with the API's message", async () => {
    const mock = renderScreen({ ...FULL_FLOW, [ACCEPT]: { status: 400, body: { statusCode: 400, message: BREACHED, error: "Bad Request" } } });
    await screen.findByLabelText("Name");
    const requestsBeforeTyping = mock.sent().length;
    const typed = "password1234";
    const globalFetch = jest.fn();
    const globalXhr = jest.fn();
    const originalFetch = global.fetch;
    const originalXhr = global.XMLHttpRequest;
    global.fetch = globalFetch as unknown as typeof fetch;
    global.XMLHttpRequest = globalXhr as unknown as typeof XMLHttpRequest;

    for (let i = 1; i <= typed.length; i++) fireEvent.change(screen.getByLabelText("Password"), { target: { value: typed.slice(0, i) } });
    global.fetch = originalFetch;
    global.XMLHttpRequest = originalXhr;

    expect(mock.sent().length - requestsBeforeTyping).toBe(0);
    expect([globalFetch.mock.calls.length, globalXhr.mock.calls.length]).toEqual([0, 0]);
    expect(screen.getByText(`At least 12 characters (${typed.length} entered)`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/breach/i);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: NAME } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toBe(BREACHED);
    expect(mock.sent().map(({ url }) => url)).toEqual([PREVIEW, ACCEPT]);
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("the length feedback counts characters, not bytes, as the API does", async () => {
    renderScreen();
    await screen.findByLabelText("Name");

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "ééé😀" } });

    expect(screen.getByText("At least 12 characters (4 entered)")).toBeTruthy();
  });

  it.each([
    ["410 (used)", gone("This invitation link has already been used")],
    ["410 (expired)", gone("This invitation link has expired")],
    ["404 (unknown)", { status: 404, body: { statusCode: 404, message: "Invitation not found", error: "Not Found" } }],
  ])("AC6: a %s link shows only the message the body carries: no inviter, date, stepper or form", async (_kind, answer) => {
    const { view } = renderScreen({ ...FULL_FLOW, [PREVIEW]: answer });

    const notice = await screen.findByRole("alert");

    const message = (answer.body as { message: string }).message;
    expect(notice.textContent).toBe(message);
    expect(view.container.textContent).toBe(`Renovix Admin · set up your account${message}`);
    expect(screen.queryByRole("navigation", { name: "Setup progress" })).toBeNull();
  });
});

