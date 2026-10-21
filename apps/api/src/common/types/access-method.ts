/**
 * A way to sign in that a route can accept: `jwt` (the `Authorization: Bearer`
 * login token), `session` (better-auth cookie), `apiKey` (`Bearer rnx_live_…`, RNX-18),
 * `portal` (`X-Portal-Session`, optional user) and `staff` (back office, RX-94).
 */
export type AccessMethod = "jwt" | "session" | "apiKey" | "portal" | "staff";
