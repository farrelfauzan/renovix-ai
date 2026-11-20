"use client";

import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { linkedAccountsQueryKey } from "@/lib/linked-accounts-query-key";
import { useAuthStore, useHydrated } from "@/lib/stores";
import { unwrapAuthResult } from "@/lib/unwrap-auth-result";

/** One sign-in method of the account: "credential" (email and password), "google" or "github". No tokens. */
export interface LinkedAccount {
  providerId: string;
}

/** RNX-78: the signed-in user's sign-in methods (Better Auth's list-accounts, which answers without tokens). */
export function useLinkedAccounts() {
  const { email, isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<LinkedAccount[]>({
    queryKey: linkedAccountsQueryKey(email),
    queryFn: async () => unwrapAuthResult<LinkedAccount[]>(await authClient.listAccounts()),
    enabled: hydrated && isLoggedIn(),
  });
}
