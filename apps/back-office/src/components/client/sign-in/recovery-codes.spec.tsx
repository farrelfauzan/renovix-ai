import { fireEvent, render, screen } from "@testing-library/react";
import { RecoveryCodes } from "./recovery-codes";

// RNX-333: the recovery-code step of the TOTP enrolment (shared by the sign-in and the invitation).

const CODES = ["1111-2222-3333-4444", "5555-6666-7777-8888", "9999-aaaa-bbbb-cccc"];
const SAVED = /I have saved these codes somewhere safe\. I understand they will not be shown again\./;

/** The text of a Blob (jsdom's Blob has no text()). */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

describe("RecoveryCodes (RNX-333)", () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalFetch = global.fetch;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("AC2: Finish is disabled until \"saved\" is ticked; then it finishes once", () => {
    const onContinue = jest.fn();
    render(<RecoveryCodes codes={CODES} onContinue={onContinue} />);
    const finish = screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement;

    fireEvent.click(finish);
    expect(finish.disabled).toBe(true);
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: SAVED }));
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("unticking \"saved\" disables Finish again", () => {
    render(<RecoveryCodes codes={CODES} onContinue={jest.fn()} />);
    const saved = screen.getByRole("checkbox", { name: SAVED });

    fireEvent.click(saved);
    fireEvent.click(saved);

    expect((screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows every code once, in a two-column list", () => {
    render(<RecoveryCodes codes={CODES} onContinue={jest.fn()} />);

    const list = screen.getByRole("list", { name: "Recovery codes" });
    expect(Array.from(list.querySelectorAll("li"), (li) => li.textContent)).toEqual(CODES);
    expect(list.className).toContain("grid-cols-2");
  });

  it("Download .txt builds the file in the browser (one code per line), releases its URL and sends no request", async () => {
    jest.useFakeTimers();
    const blobs: Blob[] = [];
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    URL.createObjectURL = jest.fn((blob: Blob) => (blobs.push(blob), "blob:recovery-codes"));
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect([this.href, this.download]).toEqual(["blob:recovery-codes", "renovix-admin-recovery-codes.txt"]);
    });
    render(<RecoveryCodes codes={CODES} onContinue={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Download .txt" }));
    jest.runAllTimers();
    jest.useRealTimers();

    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:recovery-codes");
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/plain");
    expect(await readText(blobs[0])).toBe(`${CODES.join("\n")}\n`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Copy all puts every code on the clipboard, one per line", async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<RecoveryCodes codes={CODES} onContinue={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(writeText.mock.calls).toEqual([[`${CODES.join("\n")}\n`]]);
  });
});
