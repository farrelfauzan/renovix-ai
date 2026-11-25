import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyVersionIdButton } from "./copy-version-id-button";

// RNX-315 (RNX-356 follow-up): Copy must not crash or leave an unhandled rejection when the clipboard is missing or refuses.

const NAME = "Copy id of version ver-1";
/** Waits until the click's promise has settled and Node has reported any rejection nobody handled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CopyVersionIdButton", () => {
  const saved = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const unhandled = jest.fn();

  beforeEach(() => {
    unhandled.mockClear();
    process.on("unhandledRejection", unhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", unhandled);
    if (saved) Object.defineProperty(navigator, "clipboard", saved);
    else delete (navigator as { clipboard?: Clipboard }).clipboard;
  });

  it("does nothing, and does not throw, when the browser has no clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<CopyVersionIdButton versionId="ver-1" />);

    fireEvent.click(screen.getByRole("button", { name: NAME }));
    await settle();

    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: NAME })).toBeTruthy();
  });

  it("handles a refused write: no unhandled rejection", async () => {
    const writeText = jest.fn(() => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyVersionIdButton versionId="ver-1" />);

    fireEvent.click(screen.getByRole("button", { name: NAME }));
    await settle();

    expect(writeText).toHaveBeenCalledWith("ver-1");
    await waitFor(() => expect(unhandled).not.toHaveBeenCalled());
  });
});
