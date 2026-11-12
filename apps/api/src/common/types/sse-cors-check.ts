/** What `buildSseCorsHeaders` decides on (RNX-42): the request's Origin header and the app's allowed origins. */
export type SseCorsCheck = {
  /** The Origin header, if any. */
  readonly origin: string | undefined;
  /** `resolveCorsOrigins(process.env)`: the listed origins, or `true` (CORS_ORIGIN unset in development or test: every origin). */
  readonly allowedOrigins: readonly string[] | true;
};
