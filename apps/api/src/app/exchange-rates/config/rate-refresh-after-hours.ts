/**
 * A quote or purchase refreshes the USD to IDR rate first when the latest stored rate was fetched (fetchedAt) more than
 * this many hours ago (RNX-53, D237). fetchedAt, not the rate's own date: the ECB publishes no rate on weekends.
 */
export const RATE_REFRESH_AFTER_HOURS = 24;
