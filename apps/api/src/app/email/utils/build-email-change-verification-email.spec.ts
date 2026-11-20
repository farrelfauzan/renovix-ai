import { buildEmailChangeVerificationEmail } from "./build-email-change-verification-email";

describe("RNX-78: buildEmailChangeVerificationEmail", () => {
  it("names the new address and carries the confirmation link in the HTML and the text", () => {
    const inputVerifyUrl = "http://localhost:3000/api/auth/better/verify-email?token=made-up&callbackURL=%2F";

    const actual = buildEmailChangeVerificationEmail({ verifyUrl: inputVerifyUrl, recipientEmail: "new@renovix.test" });

    expect(actual.subject).toBe("Confirm your new email address for Renovix AI");
    expect(actual.html).toContain(`href="${inputVerifyUrl}"`);
    expect(actual.html).toContain("new@renovix.test");
    expect(actual.text).toContain(inputVerifyUrl);
    expect(actual.text).toContain("new@renovix.test");
  });
});
