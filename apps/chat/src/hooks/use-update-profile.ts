"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import type { CurrentUser } from "@/hooks/use-current-user";
import { currentUserQueryKey } from "@/lib/current-user-query-key";
import { useAuthStore } from "@/lib/stores";

/**
 * RNX-77a: saves some profile fields (PATCH /auth/me) and puts the answer, the whole profile, into the current-user
 * cache. A refusal's toast is the api-client's.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: (fields: Partial<CurrentUser>) => apiClient.patch<CurrentUser>("/auth/me", fields),
    onSuccess: (saved) => queryClient.setQueryData(currentUserQueryKey(email), saved),
  });
}
