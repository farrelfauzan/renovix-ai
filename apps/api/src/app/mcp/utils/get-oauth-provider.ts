export function getOAuthProvider(provider: string): string {
  if (provider.startsWith("google-")) return "google";
  if (provider.startsWith("github")) return "github";
  if (provider.startsWith("slack")) return "slack";
  return provider;
}
