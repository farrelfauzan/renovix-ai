"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { MY_ENTITLEMENTS_QUERY_KEY } from "@/lib/my-entitlements-query-key";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** The signed-in user's package limits (GET /entitlements/me). */
export interface MyEntitlements {
  packageName: string | null;
  agents: { used: number; limit: number };
  connectedToolsPerAgent: number;
  apiAccess: boolean;
  channels: string[];
  tiers: string[];
  collaborationEnabled: boolean;
  /** The next listed package with more agents. */
  nextPackage: string | null;
  /** Every model tier the packages do not allow, with the next listed package that grants that tier. */
  lockedTiers: { tier: string; nextPackage: string | null }[];
  /** Null when apiAccess is true; otherwise the next listed package that grants API access. */
  apiAccessNextPackage: string | null;
}

/** Package limits of the signed-in user; never requested for anonymous visitors (it would 401). */
export function useMyEntitlements() {
  const { isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<MyEntitlements>({
    queryKey: MY_ENTITLEMENTS_QUERY_KEY,
    queryFn: () => apiClient.get<MyEntitlements>("/entitlements/me"),
    enabled: hydrated && isLoggedIn(),
    staleTime: 60000,
  });
}
