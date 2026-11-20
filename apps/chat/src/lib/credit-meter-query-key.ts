/**
 * React Query key of the signed-in user's credit meter (GET /chat/portal/credit-meter, RNX-330). Keyed by the
 * account's email so a new sign-in in the same tab never reads the previous account's credits.
 */
export const creditMeterQueryKey = (email: string | null) => ["credit-meter", email] as const;
