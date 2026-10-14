/** What a sign-in, a refresh or an enrolment returns to the controller, which puts the tokens into cookies. */
export type IssuedAdminSession = {
  readonly sessionId: string;
  /** "enrolment" | "full". */
  readonly scope: string;
  readonly accessToken: string;
  /** "<session id>.<random>"; only its SHA-256 hash is stored. */
  readonly refreshToken: string;
  readonly absoluteExpiresAt: Date;
};
