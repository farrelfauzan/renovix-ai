/**
 * RNX-334: what the photo upload accepts, for a friendly message before the request. The API checks the file's bytes
 * and size again and is the authority (its limit is PROFILE_PHOTO_MAX_BYTES in the auth module).
 */
export const PROFILE_PHOTO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxLabel: "2 MB",
  mimeTypes: ["image/png", "image/jpeg", "image/webp"],
} as const;
