"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { profilePhotoQueryKey } from "@/lib/profile-photo-query-key";
import { useAuthStore } from "@/lib/stores";

/** RNX-334: uploads or replaces the signed-in user's photo (PUT /auth/me/photo, multipart) and refetches the photo URL. */
export function useUploadProfilePhoto() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiClient.put("/auth/me/photo", formData, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profilePhotoQueryKey(email) }),
  });
}
