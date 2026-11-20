"use client";

import { Menu } from "lucide-react";
import { useContext } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@performa-ai/ui/components/dropdown-menu";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { SignedInAdminContext } from "@/lib/session/signed-in-admin-context";
import { useSignOut } from "@/lib/session/use-sign-out";
import { IdleTimeLeft } from "./idle-time-left";

type SessionHeaderMenuProps = {
  /** Replaced in tests only. */
  readonly api?: SessionApi;
};

/**
 * The collapsed shell's header menu (RNX-312a, D353 Q3): at 760 px or less the session footer is hidden, and its
 * idle time and Sign out are reached from here. Hidden above 760 px.
 */
export function SessionHeaderMenu({ api = defaultSessionApi }: SessionHeaderMenuProps) {
  const profile = useContext(SignedInAdminContext);
  const { signOut, failure } = useSignOut(api);
  if (!profile) return null;
  return (
    <div className="ml-auto flex items-center gap-2 wide:hidden">
      {failure && <p role="alert" className="text-xs text-rx-red-tint">{failure}</p>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Session menu" className="text-rx-ink-300 hover:bg-rx-ink-hover hover:text-rx-white">
            <Menu aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex flex-col font-normal">
            <span className="font-medium">{profile.name ?? profile.email}</span>
            <span className="text-xs text-rx-muted">
              <span className="capitalize">{profile.role}</span> · {profile.mfaEnrolled ? "MFA on" : "MFA off"}
            </span>
            <span className="text-xs text-rx-muted">
              <IdleTimeLeft idleExpiresAt={profile.idleExpiresAt} />
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
