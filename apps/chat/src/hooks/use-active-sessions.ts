"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { activeSessionsQueryKey } from "@/lib/active-sessions-query-key";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** One row of GET /auth/sessions: no token, IP address or location. */
export interface ActiveSession {
  id: string;
  /** Read from the user agent, e.g. "Chrome on macOS". */
  device: string;
  lastActiveAt: string;
  /** True for this browser's session. */
  isCurrent: boolean;
}

/** RNX-78: the signed-in user's active sessions. */
export function useActiveSessions() {
  const { email, isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<ActiveSession[]>({
    queryKey: activeSessionsQueryKey(email),
    queryFn: () => apiClient.get<ActiveSession[]>("/auth/sessions"),
    enabled: hydrated && isLoggedIn(),
  });
}
