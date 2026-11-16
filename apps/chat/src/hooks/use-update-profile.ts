"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import type { CurrentUser } from "@/hooks/use-current-user";
import { currentUserQueryKey } from "@/lib/current-user-query-key";
import { useAuthStore } from "@/lib/stores";

/** The fields PATCH /auth/me accepts from Settings > General (the strict DTO refuses any other key). */
export type ProfileUpdate = Partial<
  Pick<CurrentUser, "name" | "role" | "jobTitle" | "phone" | "signupGoal" | "locale" | "country" | "timezone" | "defaultModelTier">
>;

/**
 * RNX-77a: saves some profile fields (PATCH /auth/me) and puts the answer, the whole profile, into the current-user
 * cache. A refusal's toast is the api-client's.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: (fields: ProfileUpdate) => apiClient.patch<CurrentUser>("/auth/me", fields),
    onSuccess: (saved) => queryClient.setQueryData(currentUserQueryKey(email), saved),
  });
}
