import { SignInSecuritySettings } from "@/components/settings/sign-in-security/sign-in-security-settings";

/** RNX-78: Settings > Sign-in and security. Better Auth sends the browser back here with `?error=` when a link or an email confirmation fails. */
export default async function SignInSecurityPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  return <SignInSecuritySettings linkError={typeof error === "string" ? error : undefined} />;
}
