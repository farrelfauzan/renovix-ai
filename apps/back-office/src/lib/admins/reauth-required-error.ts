import { RefusedError } from "@/lib/sign-in/refused-error";

/** The API answered 403 "Re-authentication required": ask for the password and a TOTP code, then retry once. */
export class ReauthRequiredError extends RefusedError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "ReauthRequiredError";
  }
}
