/**
 * React Query key of the signed-in user's profile (GET /auth/me, RNX-33). Keyed by the account's email so a new
 * sign-in in the same tab never reads the previous account's answer.
 */
export const currentUserQueryKey = (email: string | null) => ["current-user", email] as const;
