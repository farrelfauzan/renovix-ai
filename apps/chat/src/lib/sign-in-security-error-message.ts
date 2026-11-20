/** Better Auth's error codes in the `error` query parameter it sends the browser back with, and what they mean here. */
const MESSAGES: Readonly<Record<string, string>> = {
  "email_doesn't_match":
    "That account uses a different email address. You can only link a Google or GitHub account with the same email as your Renovix account.",
  account_already_linked_to_different_user: "That account is already linked to another Renovix account.",
  INVALID_TOKEN: "The email change link is not valid. Ask for a new one.",
  TOKEN_EXPIRED: "The email change link has expired. Ask for a new one.",
};

/** RNX-78: the message shown for the `error` Better Auth puts on the settings URL after a link or an email confirmation. */
export function signInSecurityErrorMessage(code: string): string {
  return MESSAGES[code] ?? "That did not work. Please try again.";
}
