/**
 * The chat portal's session cookie (RNX-225): an httpOnly id the API creates (a random UUID) when a portal request
 * has none. It keys the portal session (free-tier counter, usage, link-session). It lasts a year, as the client-made
 * id it replaces did in the browser's localStorage.
 */
export const PORTAL_SESSION_COOKIE = { name: "portal_session", maxAgeSeconds: 365 * 24 * 60 * 60 } as const;
