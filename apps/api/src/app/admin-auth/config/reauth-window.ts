/**
 * A route that declares `reauth: true` accepts a re-authentication this recent, in minutes (RX-95, D219):
 * one constant for every sensitive back-office action, not configurable (was ADMIN_AUTH_REAUTH_WINDOW_MINUTES,
 * default 5, in RX-94).
 */
export const REAUTH_WINDOW_MINUTES = 2;
