/**
 * React Query key of the signed-in user's own profile photo URL (GET /auth/me/photo, RNX-334). Keyed by the account's
 * email, as the current-user query is, so a new sign-in in the same tab never shows the previous account's photo.
 */
export const profilePhotoQueryKey = (email: string | null) => ["profile-photo", email] as const;
