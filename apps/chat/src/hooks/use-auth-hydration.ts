"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores";
import { authClient } from "@/lib/auth-client";

/**
 * On mount, check for a Better Auth session (the httpOnly cookie).
 * If valid, refresh the user. If not, clear auth state.
 * Also invalidates portal queries so tier is re-evaluated.
 */
export function useAuthHydration() {
  const { sessionAuth, setSessionAuth, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const invalidatePortal = () => {
      queryClient.invalidateQueries({ queryKey: ["portal-usage"] });
      queryClient.invalidateQueries({ queryKey: ["portal-models"] });
    };

    authClient
      .getSession()
      .then((res) => {
        if (res.data?.user) {
          const user = res.data.user as any;
          setSessionAuth(
            user.email,
            user.name ?? null,
            user.image ?? user.avatar ?? null,
          );
          invalidatePortal();
          return;
        }
        if (sessionAuth) {
          logout();
          invalidatePortal();
        }
      })
      .catch(() => {
        // No active session — stay logged out
      });
  }, [sessionAuth, setSessionAuth, logout, queryClient]);
}
