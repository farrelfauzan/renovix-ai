"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { profilePhotoQueryKey } from "@/lib/profile-photo-query-key";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** The API's presigned photo URL lives 10 minutes (PROFILE_PHOTO_URL_EXPIRY_SECONDS); it is fetched again after 5. */
const PHOTO_URL_STALE_MS = 5 * 60 * 1000;

/** GET /auth/me/photo: where the signed-in user's own photo loads from (`url` is null for none). */
export interface ProfilePhoto {
  url: string | null;
}

/**
 * RNX-334: the signed-in user's own photo URL, the one source every place that shows it uses (the chat header and the
 * Profile section). An uploaded photo is a short-lived presigned URL, so the `avatar` column the session and
 * GET /auth/me return (a storage key for an upload) is never used as an image address.
 */
export function useProfilePhoto() {
  const { email, isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<ProfilePhoto>({
    queryKey: profilePhotoQueryKey(email),
    queryFn: () => apiClient.get<ProfilePhoto>("/auth/me/photo"),
    enabled: hydrated && isLoggedIn(),
    staleTime: PHOTO_URL_STALE_MS,
  });
}
