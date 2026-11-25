"use client";

import { useContext } from "react";
import { Avatar, AvatarFallback } from "@performa-ai/ui/components/avatar";
import { Button } from "@performa-ai/ui/components/button";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import { initialsOf } from "@/lib/session/initials-of";
import type { SessionApi } from "@/lib/session/session-api";
import { SignedInAdminContext } from "@/lib/session/signed-in-admin-context";
import { useSignOut } from "@/lib/session/use-sign-out";
import { SessionTimeLeft } from "./session-time-left";

type SessionFooterProps = {
  /** Replaced in tests only. */
  readonly api?: SessionApi;
};

/**
 * The sidebar's session footer (RNX-312a): initials, name, role, MFA state, the approximate idle time left and
 * Sign out. Above 760 px only; narrower, the header menu has the idle time and Sign out (D353 Q3).
 */
export function SessionFooter({ api = defaultSessionApi }: SessionFooterProps) {
  const profile = useContext(SignedInAdminContext);
  const { signOut, failure } = useSignOut(api);
  if (!profile) return null;
  return (
    <div role="group" aria-label="Session" className="flex flex-col gap-2 border-t border-rx-ink-active px-2.5 pt-3 pb-1 text-xs text-rx-dark-muted narrow:hidden">
      <div className="flex items-center gap-2.5">
        <Avatar className="size-7">
          <AvatarFallback className="bg-rx-ink-active text-[11px] font-semibold text-rx-white">{initialsOf(profile.name, profile.email)}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-rx-white">{profile.name ?? profile.email}</span>
          <span>
            <span className="capitalize">{profile.role}</span> · {profile.mfaEnrolled ? "MFA on" : "MFA off"}
          </span>
        </span>
      </div>
      <span>
        <SessionTimeLeft idleExpiresAt={profile.idleExpiresAt} absoluteExpiresAt={profile.absoluteExpiresAt} /> ·{" "}
        <Button variant="link" type="button" onClick={signOut} className="h-auto p-0 text-xs font-normal text-rx-dark-accent">
          Sign out
        </Button>
      </span>
      {failure && <p role="alert" className="text-rx-red-tint">{failure}</p>}
    </div>
  );
}
