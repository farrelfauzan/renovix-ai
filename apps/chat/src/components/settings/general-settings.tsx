"use client";

import Link from "next/link";
import { PreferencesSection } from "@/components/settings/general/preferences-section";
import { ProfileSection } from "@/components/settings/general/profile-section";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useMyEntitlements } from "@/hooks/use-my-entitlements";

/**
 * Settings > General (RNX-77a, artboard UserSettings): the Profile and Preferences sections, each with its own Save,
 * and the link to the API keys page (RNX-82). Photo, sign-in and security, notifications and data are other tickets.
 */
export function GeneralSettings() {
  const { data: user } = useCurrentUser();
  const { data: entitlements } = useMyEntitlements();

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">General</h1>
        <span className="text-[13px] text-muted-foreground">Changes save when you press Save in each section.</span>
      </header>
      {user && entitlements ? (
        <>
          <ProfileSection user={user} />
          <PreferencesSection user={user} entitlements={entitlements} />
        </>
      ) : (
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">API keys</h2>
        <p className="text-xs text-muted-foreground">
          Create and revoke keys for your own software on the{" "}
          <Link href="/settings/api-keys" className="underline">
            API keys page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
