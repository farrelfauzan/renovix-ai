/** RNX-334: true when `avatar` is an external https URL (the picture a Google or GitHub sign-up brought). */
export function isExternalPhotoUrl(avatar: string | null): avatar is string {
  return avatar !== null && avatar.startsWith("https://");
}
