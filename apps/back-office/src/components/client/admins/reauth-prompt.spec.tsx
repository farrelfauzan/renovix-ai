import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReauthPromptState } from "@/lib/admins/reauth-prompt-state";
import { ReauthPrompt } from "./reauth-prompt";

// RNX-332 AC5: the re-authentication prompt in the canvas box, with the code in six boxes, still sends { password, totp }.

const PASSWORD = "correct horse battery staple";
const TOTP = "123456";

function renderPrompt() {
  const mockSubmit = jest.fn();
  const mockCancel = jest.fn();
  const prompt: ReauthPromptState = { error: null, isSubmitting: false, submit: mockSubmit, cancel: mockCancel };
  render(<ReauthPrompt prompt={prompt} />);
  return { dialog: screen.getByRole("dialog", { name: "Confirm it is you" }), mockSubmit, mockCancel };
}

function fill(dialog: HTMLElement, inputPassword: string, inputCode: string) {
  fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: inputPassword } });
  fireEvent.change(within(dialog).getByLabelText("Authenticator code"), { target: { value: inputCode } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
}

describe("ReauthPrompt (RNX-332)", () => {
  it("AC5: submits the password and the six digits as { password, totp }, as before", () => {
    const { dialog, mockSubmit } = renderPrompt();
    const expectedCredentials = { password: PASSWORD, totp: TOTP };

    fill(dialog, PASSWORD, TOTP);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith(expectedCredentials);
  });

  it.each([
    ["the password is missing", "", TOTP],
    ["the code is missing", PASSWORD, ""],
    ["the code has fewer than six digits", PASSWORD, "12345"],
  ])("AC5: does not submit when %s", (_case, inputPassword, inputCode) => {
    const { dialog, mockSubmit } = renderPrompt();

    fill(dialog, inputPassword, inputCode);

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("Cancel closes the prompt without submitting", () => {
    const { dialog, mockSubmit, mockCancel } = renderPrompt();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
