/**
 * A way to sign in that a route can accept: `session` (better-auth cookie), `apiKey` (`Bearer rnx_live_…`,
 * RNX-18), `portal` (`X-Portal-Session`, optional user) and `staff` (back office, RX-94). The login JWT is not
 * one any more (RNX-225): no route accepts it.
 */
export type AccessMethod = "session" | "apiKey" | "portal" | "staff";
