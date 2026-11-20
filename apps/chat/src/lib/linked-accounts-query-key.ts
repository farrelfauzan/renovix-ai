/** RNX-78: React Query key of the signed-in user's sign-in methods (Better Auth's list-accounts), keyed by the account's email. */
export const linkedAccountsQueryKey = (email: string | null) => ["linked-accounts", email] as const;
