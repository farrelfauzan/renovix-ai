/** RNX-78: React Query key of the signed-in user's active sessions (GET /auth/sessions), keyed by the account's email. */
export const activeSessionsQueryKey = (email: string | null) => ["active-sessions", email] as const;
