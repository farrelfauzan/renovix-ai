/** What `isAllowedUserOrigin` decides on (RNX-272): the request's method and headers, and the allowed origins. */
export type UserOriginCheck = {
  readonly method: string;
  /** The Origin header, if any. */
  readonly origin: string | undefined;
  /** The Referer header, if any: read only when there is no Origin. */
  readonly referer: string | undefined;
  /** `resolveCorsOrigins(process.env)`: the listed origins, or `true` (CORS_ORIGIN unset: every origin). */
  readonly allowedOrigins: readonly string[] | true;
};
