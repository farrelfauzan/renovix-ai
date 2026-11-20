"use client";

import { ActiveSessions } from "@/components/settings/sign-in-security/active-sessions";
import { EmailRow } from "@/components/settings/sign-in-security/email-row";
import { LinkedProviderRow } from "@/components/settings/sign-in-security/linked-provider-row";
import { PasswordRow } from "@/components/settings/sign-in-security/password-row";
import { useActiveSessions } from "@/hooks/use-active-sessions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { signInSecurityErrorMessage } from "@/lib/sign-in-security-error-message";

/**
 * Settings > Sign-in and security (RNX-78, artboard UserSettings): email, password, Google and GitHub, and the active
 * sessions. `linkError` is the `error` Better Auth put on the URL after a link or an email confirmation.
 */
export function SignInSecuritySettings({ linkError }: { linkError?: string }) {
  const { data: user } = useCurrentUser();
  const { data: accounts } = useLinkedAccounts();
  const { data: sessions } = useActiveSessions();
  const providerIds = accounts?.map((account) => account.providerId) ?? [];
  const isOnlyMethod = providerIds.length === 1;
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Sign-in and security</h1>
        <span className="text-[13px] text-muted-foreground">How you sign in, and where your account is signed in.</span>
      </header>
      {linkError ? (
        <p role="alert" className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
          {signInSecurityErrorMessage(linkError)}
        </p>
      ) : null}
      {user && accounts ? (
        <section aria-labelledby="settings-sign-in" className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
          <h2 id="settings-sign-in" className="text-lg font-semibold">
            Sign-in
          </h2>
          <div className="flex flex-col">
            <EmailRow user={user} />
            <PasswordRow hasPassword={providerIds.includes("credential")} />
            <LinkedProviderRow provider="google" label="Google" isLinked={providerIds.includes("google")} isOnlyMethod={isOnlyMethod} />
            <LinkedProviderRow provider="github" label="GitHub" isLinked={providerIds.includes("github")} isOnlyMethod={isOnlyMethod} />
          </div>
        </section>
      ) : (
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      )}
      {sessions ? <ActiveSessions sessions={sessions} /> : null}
    </div>
  );
}
