"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
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
  nextPackage: string | null;
}

/** Package limits of the signed-in user; never requested for anonymous visitors (it would 401). */
export function useMyEntitlements() {
  const { isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<MyEntitlements>({
    queryKey: ["my-entitlements"],
    queryFn: () => apiClient.get<MyEntitlements>("/entitlements/me"),
    enabled: hydrated && isLoggedIn(),
    staleTime: 60000,
  });
}
