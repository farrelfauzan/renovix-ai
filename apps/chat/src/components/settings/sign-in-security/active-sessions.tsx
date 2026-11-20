"use client";

import { Button } from "@performa-ai/ui/components/button";
import { SessionRow } from "@/components/settings/sign-in-security/session-row";
import type { ActiveSession } from "@/hooks/use-active-sessions";
import { useSignOutOtherSessions } from "@/hooks/use-sign-out-other-sessions";

/** RNX-78: the account's active sessions and "Sign out others", which ends every session but this one at once. */
export function ActiveSessions({ sessions }: { sessions: ActiveSession[] }) {
  const signOutOthers = useSignOutOtherSessions();
  const hasOthers = sessions.some((session) => !session.isCurrent);
  return (
    <section aria-labelledby="settings-active-sessions" className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="settings-active-sessions" className="text-lg font-semibold">
            Active sessions
          </h2>
          <span className="text-[13px] text-muted-foreground">Where your account is signed in: the device and its last activity.</span>
        </div>
        <Button type="button" variant="outline" disabled={!hasOthers || signOutOthers.isPending} onClick={() => signOutOthers.mutate()}>
          Sign out others
        </Button>
      </div>
      <ul aria-label="Active sessions" className="flex flex-col">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </ul>
    </section>
  );
}
