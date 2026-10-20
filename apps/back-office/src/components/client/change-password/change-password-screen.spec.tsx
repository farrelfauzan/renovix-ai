import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import { SignedOutError } from "@/lib/api/signed-out-error";
import { createSessionApi } from "@/lib/session/session-api";
import { ChangePasswordScreen } from "./change-password-screen";

// RNX-207: the forced password change against a mocked back-office API client (the RX-95 routes).

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const PASSWORD_PATH = "/api/v1/admin/auth/password";
const SIGN_OUT_PATH = "/api/v1/admin/auth/sign-out";
const NEW_PASSWORD = "another long passphrase 77";

type Answer = { status: number; body?: unknown } | "signed-out";

/** A mocked ApiClient: one answer per path ("signed-out": the session client's SignedOutError); records path and body. */
function createMockApi(answers: Record<string, Answer>) {
  const request = jest.fn(async (path: string, _init?: RequestInit): Promise<Response> => {
    const answer = answers[path];
    if (answer === "signed-out") throw new SignedOutError();
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  });
  const client: ApiClient = { request };
  const sent = () => request.mock.calls.map(([path, init]) => ({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
  return { api: createSessionApi(client), sent };
}

function changePassword() {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: NEW_PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ChangePasswordScreen (RNX-207)", () => {
  beforeEach(() => replace.mockClear());

  it("sends the new password, then the overview", async () => {
    const mock = createMockApi({ [PASSWORD_PATH]: { status: 200, body: { scope: "full" } } });
    render(<ChangePasswordScreen api={mock.api} />);

    changePassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mock.sent()).toEqual([{ path: PASSWORD_PATH, body: { newPassword: NEW_PASSWORD } }]);
  });

  it("a password the API refuses: its message, and no navigation", async () => {
    const mock = createMockApi({ [PASSWORD_PATH]: { status: 400, body: { statusCode: 400, message: "Choose a new password, not the current one.", error: "Bad Request" } } });
    render(<ChangePasswordScreen api={mock.api} />);

    changePassword();

    expect((await screen.findByRole("alert")).textContent).toBe("Choose a new password, not the current one.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("sign-out works from here: the sign-out route, then sign-in", async () => {
    const mock = createMockApi({ [SIGN_OUT_PATH]: { status: 204 } });
    render(<ChangePasswordScreen api={mock.api} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(mock.sent()).toEqual([{ path: SIGN_OUT_PATH, body: undefined }]);
  });

  it("a session that is already over: sign-in", async () => {
    const mock = createMockApi({ [PASSWORD_PATH]: "signed-out" });
    render(<ChangePasswordScreen api={mock.api} />);

    changePassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("the input is a password with the new-password hint, and nothing is logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => jest.spyOn(console, method));
    const mock = createMockApi({ [PASSWORD_PATH]: { status: 200, body: { scope: "full" } } });
    render(<ChangePasswordScreen api={mock.api} />);
    const input = screen.getByLabelText("New password");
    expect([input.getAttribute("type"), input.getAttribute("autocomplete")]).toEqual(["password", "new-password"]);

    changePassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain(NEW_PASSWORD);
    spies.forEach((spy) => spy.mockRestore());
  });
});
