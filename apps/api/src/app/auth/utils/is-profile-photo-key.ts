import { buildProfilePhotoKeyPrefix } from "./build-profile-photo-key-prefix";

/** RNX-334: true when `avatar` is the storage key of one of this user's own uploaded photos (not an external URL). */
export function isProfilePhotoKey(userId: string, avatar: string | null): avatar is string {
  return avatar !== null && avatar.startsWith(buildProfilePhotoKeyPrefix(userId));
}
