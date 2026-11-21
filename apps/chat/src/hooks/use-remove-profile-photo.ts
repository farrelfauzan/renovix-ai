"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { profilePhotoQueryKey } from "@/lib/profile-photo-query-key";
import { useAuthStore } from "@/lib/stores";

/** RNX-334: removes the signed-in user's photo (DELETE /auth/me/photo) and refetches the photo URL. */
export function useRemoveProfilePhoto() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: () => apiClient.delete("/auth/me/photo"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profilePhotoQueryKey(email) }),
  });
}
