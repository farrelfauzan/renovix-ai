/**
 * The oldest USD to IDR rate a quote or purchase may use, in days between the rate's own date and today (UTC)
 * (RNX-53, D237). A rate exactly this old is still used; an older one, or none, refuses with 503 and notifies the owners.
 */
export const MAX_RATE_AGE_DAYS = 7;
