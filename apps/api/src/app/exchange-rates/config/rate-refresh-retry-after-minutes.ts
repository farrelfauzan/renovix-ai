/**
 * After a FAILED rate refresh, an instance tries again only after this many minutes (RNX-53): until then a quote or
 * purchase uses the stored rate (or gets the 503) without a fetch, so a public route cannot drive a fetch, and a wait of
 * up to the source timeout, on every call while the source is down.
 */
export const RATE_REFRESH_RETRY_AFTER_MINUTES = 5;
