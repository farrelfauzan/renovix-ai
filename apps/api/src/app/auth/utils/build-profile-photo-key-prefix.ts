/** RNX-334: every storage key of this user's profile photos starts with this (`users/<userId>/profile-photo/`). */
export function buildProfilePhotoKeyPrefix(userId: string): string {
  return `users/${userId}/profile-photo/`;
}
