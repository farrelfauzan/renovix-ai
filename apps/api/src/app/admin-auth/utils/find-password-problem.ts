import type { PasswordCheckInput } from "../types/password-check-input";

const SERVICE_NAME = "renovix";
/** An email name shorter than this is not looked for inside the password (it would refuse too much). */
const MIN_EMAIL_NAME_LENGTH = 3;

/**
 * Why a new back-office password is refused, or null when it is acceptable (RX-94, D61, NIST SP 800-63B):
 * too short (characters, not bytes), on the breached list (whole password, case-insensitive), or containing
 * the service name or the name part of the email (case-insensitive).
 */
export function findPasswordProblem({ password, email, minLength, breached }: PasswordCheckInput): string | null {
  const lower = password.toLowerCase();
  const emailName = email.split("@")[0].toLowerCase();
  if ([...password].length < minLength) return `The password must have at least ${minLength} characters.`;
  if (breached.has(lower)) return "This password is on a list of breached passwords. Choose another one.";
  if (lower.includes(SERVICE_NAME)) return `The password must not contain "${SERVICE_NAME}".`;
  if (emailName.length >= MIN_EMAIL_NAME_LENGTH && lower.includes(emailName)) {
    return "The password must not contain the name part of the email address.";
  }
  return null;
}
