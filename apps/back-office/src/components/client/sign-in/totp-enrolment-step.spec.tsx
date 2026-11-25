import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "qrcode";
import type { ApiClient } from "@/lib/api/api-client";
import { createSignInApi } from "@/lib/sign-in/sign-in-api";
import { TotpEnrolmentStep } from "./totp-enrolment-step";

// RNX-349: the QR code of the authenticator setup, against a mocked back-office API client.

const SECRET = "JBSWY3DPEHPK3PXP";
const OTPAUTH_URI = `otpauth://totp/Renovix%20Admin:ops%40example.com?secret=${SECRET}&issuer=Renovix%20Admin`;
const TOTP = "123456";
const RECOVERY_CODES = ["1111-2222-3333-4444"];
const QUIET_ZONE_MODULES = 4;
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

function createApi() {
  const answers: Record<string, unknown> = {
    "/api/v1/admin/auth/totp/enrol": { secret: SECRET, otpauthUri: OTPAUTH_URI },
    "/api/v1/admin/auth/totp/confirm": { recoveryCodes: RECOVERY_CODES },
  };
  const request = jest.fn(async (path: string): Promise<Response> => ({ ok: true, status: 200, json: async () => answers[path] }) as Response);
  const client: ApiClient = { request };
  return createSignInApi(client, client);
}

/** The path a QR code for `text` must draw: the library's own modules, one square per dark module. */
function expectedPath(text: string): string {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  let path = "";
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) path += `M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`;
    }
  }
  return path;
}

async function startEnrolment() {
  render(<TotpEnrolmentStep api={createApi()} onDone={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
  return screen.findByRole("img", { name: "QR code for your authenticator app" });
}

describe("TotpEnrolmentStep QR code (RNX-349)", () => {
  const originalFetch = global.fetch;
  const originalXhr = global.XMLHttpRequest;

  afterEach(() => {
    global.fetch = originalFetch;
    global.XMLHttpRequest = originalXhr;
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("AC1: the QR is generated from exactly the otpauthUri the API returned, not from the secret alone", async () => {
    const qr = await startEnrolment();

    const drawn = qr.querySelector("path")?.getAttribute("d");
    expect(drawn).toBe(expectedPath(OTPAUTH_URI));
    expect(drawn).not.toBe(expectedPath(SECRET));
  });

  it("AC2: the key is shown next to the QR and its text equals the API's secret (RNX-333: in groups of four, spaced by layout only)", async () => {
    await startEnrolment();

    const key = screen.getByText("Cannot scan? Enter this key by hand").nextElementSibling?.querySelector("code");
    expect(key?.textContent).toBe(SECRET);
    expect(Array.from(key?.children ?? [], (group) => group.textContent)).toEqual(["JBSW", "Y3DP", "EHPK", "3PXP"]);
  });

  it("AC3: rendering the QR makes no request: an inline svg, no img, no external src or href", async () => {
    const fetchSpy = jest.fn();
    const xhrSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    global.XMLHttpRequest = xhrSpy as unknown as typeof XMLHttpRequest;

    const qr = await startEnrolment();

    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.querySelectorAll("[src], [href]")).toHaveLength(0);
  });

  it("AC4: the secret and URI reach no console, storage or cookie, and are gone from the DOM after confirm", async () => {
    const consoleSpies = CONSOLE_METHODS.map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    await startEnrolment();

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: TOTP } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm authenticator" }));
    await screen.findByRole("list", { name: "Recovery codes" });

    const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
    const stored = JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }, document.cookie]);
    for (const text of [SECRET, OTPAUTH_URI]) {
      expect(logged).not.toContain(text);
      expect(stored).not.toContain(text);
      expect(document.body.textContent).not.toContain(text);
    }
    expect(document.querySelector("svg[aria-label='QR code for your authenticator app']")).toBeNull();
  });
});

describe("TotpEnrolmentStep key and code (RNX-333)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("Copy puts the whole key, ungrouped, on the clipboard, and nothing else", async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await startEnrolment();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(writeText.mock.calls).toEqual([[SECRET]]);
  });

  it("a refused clipboard: the button keeps its label and nothing is thrown", async () => {
    const writeText = jest.fn(async (_text: string) => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await startEnrolment();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("the first code goes in the six boxes; fewer than six digits are not sent", async () => {
    const api = createApi();
    const confirmTotp = jest.spyOn(api, "confirmTotp");
    render(<TotpEnrolmentStep api={api} onDone={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
    await screen.findByRole("img", { name: "QR code for your authenticator app" });

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm authenticator" }));

    expect(confirmTotp).not.toHaveBeenCalled();
  });
});
