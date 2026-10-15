/** The admin session is over (refresh failed, or the retried request was refused again): show the sign-in screen. */
export class SignedOutError extends Error {
  constructor() {
    super("Signed out");
    this.name = "SignedOutError";
  }
}
