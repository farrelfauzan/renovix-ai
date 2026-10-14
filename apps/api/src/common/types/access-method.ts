/**
 * A way to sign in that a route can accept: `jwt` (the `Authorization: Bearer`
 * login token), `session` (better-auth cookie), `apiKey` (`Bearer sk_live_…`),
 * `portal` (`X-Portal-Session`, optional user) and `staff` (back office, RX-94).
 */
export type AccessMethod = "jwt" | "session" | "apiKey" | "portal" | "staff";
