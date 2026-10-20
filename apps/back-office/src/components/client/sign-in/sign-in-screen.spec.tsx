import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import { createSignInApi } from "@/lib/sign-in/sign-in-api";
import { SignInScreen } from "./sign-in-screen";

// RNX-188 part 1: the sign-in screens against a mocked back-office API client (the RX-94 routes and answers).

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const EMAIL = "ops@example.com";
const PASSWORD = "correct horse battery staple";
const TOTP = "123456";
const RECOVERY_CODE = "a1b2-c3d4-e5f6-a7b8";
const SECRET = "JBSWY3DPEHPK3PXP";
const OTPAUTH_URI = `otpauth://totp/Renovix%20Admin:ops%40example.com?secret=${SECRET}&issuer=Renovix%20Admin`;
const RECOVERY_CODES = ["1111-2222-3333-4444", "5555-6666-7777-8888"];
/** The API's one answer to unknown email, wrong password, wrong or missing factor AND a locked account (RX-94 specs). */
const GENERIC_401 = { status: 401, body: { statusCode: 401, message: "Invalid credentials", error: "Unauthorized" } };

type Answer = { status: number; body: unknown };

/** A mocked ApiClient: one answer per route path; records each request's path and JSON body. */
function createMockClient(answers: Record<string, Answer>) {
  const request = jest.fn(async (path: string, _init?: RequestInit): Promise<Response> => {
    const { status, body } = answers[path];
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  const client: ApiClient = { request };
  const sent = () => request.mock.calls.map(([path, init]) => ({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
  return { api: createSignInApi(client, client), request, sent };
}

function enterCredentials() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function signInWithTotp() {
  enterCredentials();
  fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: TOTP } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("SignInScreen (RNX-188)", () => {
  beforeEach(() => replace.mockClear());

  it("password, then the TOTP step, then signed in: one sign-in request with both, then the overview", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": { status: 200, body: { scope: "full" } } });
    render(<SignInScreen api={mock.api} />);

    enterCredentials();
    expect(mock.request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mock.sent()).toEqual([{ path: "/api/v1/admin/auth/sign-in", body: { email: EMAIL, password: PASSWORD, totp: TOTP } }]);
  });

  it("password, then a recovery code instead, then signed in", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": { status: 200, body: { scope: "full" } } });
    render(<SignInScreen api={mock.api} />);
    enterCredentials();

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: RECOVERY_CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mock.sent()).toEqual([{ path: "/api/v1/admin/auth/sign-in", body: { email: EMAIL, password: PASSWORD, recoveryCode: RECOVERY_CODE } }]);
  });

  it("wrong credentials: only the API's message is shown, and the admin is not signed in", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": GENERIC_401 });
    render(<SignInScreen api={mock.api} />);

    signInWithTotp();

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect(replace).not.toHaveBeenCalled();
  });

  it("a wrong TOTP code: the API's message only, not signed in, and the code step stays for another try", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": GENERIC_401 });
    render(<SignInScreen api={mock.api} />);

    signInWithTotp();

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(mock.sent()).toEqual([{ path: "/api/v1/admin/auth/sign-in", body: { email: EMAIL, password: PASSWORD, totp: TOTP } }]);
  });

  it("a used recovery code: the API's message only, and not signed in", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": GENERIC_401 });
    render(<SignInScreen api={mock.api} />);
    enterCredentials();

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: RECOVERY_CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect(replace).not.toHaveBeenCalled();
    expect(mock.sent()).toEqual([{ path: "/api/v1/admin/auth/sign-in", body: { email: EMAIL, password: PASSWORD, recoveryCode: RECOVERY_CODE } }]);
  });

  it("enrolment: a wrong first code is refused with the API's message, no recovery codes, and the secret stays for another try", async () => {
    const mock = createMockClient({
      "/api/v1/admin/auth/sign-in": { status: 200, body: { scope: "enrolment" } },
      "/api/v1/admin/auth/totp/enrol": { status: 200, body: { secret: SECRET, otpauthUri: OTPAUTH_URI } },
      "/api/v1/admin/auth/totp/confirm": { status: 400, body: { statusCode: 400, message: "Invalid code", error: "Bad Request" } },
    });
    render(<SignInScreen api={mock.api} />);
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "No authenticator set up yet: continue without a code" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    fireEvent.change(await screen.findByLabelText("Code from your authenticator app"), { target: { value: TOTP } });

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid code");
    expect(screen.queryByRole("list", { name: "Recovery codes" })).toBeNull();
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a locked account: only the API's message is shown (the API answers a lock with the same 401), nothing says locked", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": GENERIC_401 });
    render(<SignInScreen api={mock.api} />);

    signInWithTotp();

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect(document.body.textContent).not.toMatch(/lock|exist|unknown|attempt/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it("an admin the API refuses with another status (as a suspension would be) sees the API's message verbatim and is not signed in", async () => {
    const mock = createMockClient({ "/api/v1/admin/auth/sign-in": { status: 403, body: { statusCode: 403, message: "Forbidden", error: "Forbidden" } } });
    render(<SignInScreen api={mock.api} />);

    signInWithTotp();

    expect((await screen.findByRole("alert")).textContent).toBe("Forbidden");
    expect(replace).not.toHaveBeenCalled();
  });

  it("enrolment: the secret and the otpauth URI as text, the first code gives the recovery codes once, then the overview; the secret is gone after", async () => {
    const mock = createMockClient({
      "/api/v1/admin/auth/sign-in": { status: 200, body: { scope: "enrolment" } },
      "/api/v1/admin/auth/totp/enrol": { status: 200, body: { secret: SECRET, otpauthUri: OTPAUTH_URI } },
      "/api/v1/admin/auth/totp/confirm": { status: 200, body: { recoveryCodes: RECOVERY_CODES } },
    });
    render(<SignInScreen api={mock.api} />);
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "No authenticator set up yet: continue without a code" }));

    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));

    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(screen.getByText(OTPAUTH_URI)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Code from your authenticator app"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const codes = await screen.findByRole("list", { name: "Recovery codes" });
    expect(Array.from(codes.querySelectorAll("li"), (li) => li.textContent)).toEqual(RECOVERY_CODES);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(replace).toHaveBeenCalledWith("/");
    expect(mock.sent()).toEqual([
      { path: "/api/v1/admin/auth/sign-in", body: { email: EMAIL, password: PASSWORD } },
      { path: "/api/v1/admin/auth/totp/enrol", body: undefined },
      { path: "/api/v1/admin/auth/totp/confirm", body: { code: TOTP } },
    ]);
  });

  it("the inputs carry the password-manager hints: username, current-password, one-time-code", async () => {
    const mock = createMockClient({
      "/api/v1/admin/auth/sign-in": { status: 200, body: { scope: "enrolment" } },
      "/api/v1/admin/auth/totp/enrol": { status: 200, body: { secret: SECRET, otpauthUri: OTPAUTH_URI } },
    });
    render(<SignInScreen api={mock.api} />);
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    enterCredentials();
    expect(screen.getByLabelText("Authenticator code").getAttribute("autocomplete")).toBe("one-time-code");
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    expect(screen.getByLabelText("Recovery code").getAttribute("autocomplete")).toBe("one-time-code");
    fireEvent.click(screen.getByRole("button", { name: "No authenticator set up yet: continue without a code" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));

    expect((await screen.findByLabelText("Code from your authenticator app")).getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("logs nothing: no password, code, recovery code or secret reaches the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => jest.spyOn(console, method));
    const mock = createMockClient({
      "/api/v1/admin/auth/sign-in": { status: 200, body: { scope: "enrolment" } },
      "/api/v1/admin/auth/totp/enrol": { status: 200, body: { secret: SECRET, otpauthUri: OTPAUTH_URI } },
      "/api/v1/admin/auth/totp/confirm": { status: 200, body: { recoveryCodes: RECOVERY_CODES } },
    });
    render(<SignInScreen api={mock.api} />);
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: RECOVERY_CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    fireEvent.change(await screen.findByLabelText("Code from your authenticator app"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("list", { name: "Recovery codes" });

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of [PASSWORD, TOTP, RECOVERY_CODE, SECRET, ...RECOVERY_CODES]) expect(logged).not.toContain(secret);
    spies.forEach((spy) => spy.mockRestore());
  });
});
