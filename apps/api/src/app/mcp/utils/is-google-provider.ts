/**
 * Check if a provider name uses Google OAuth (shared credentials flow)
 */
export function isGoogleProvider(name: string): boolean {
  return name.startsWith("google-");
}
