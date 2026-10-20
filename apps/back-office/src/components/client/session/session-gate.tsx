"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SignedOutError } from "@/lib/api/signed-out-error";
import { decideGate } from "@/lib/session/decide-gate";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { GateDecision } from "@/lib/session/gate-decision";
import { isPublicPath } from "@/lib/session/is-public-path";
import type { SessionApi } from "@/lib/session/session-api";

/** The answer for one route; no decision: the session could not be checked. */
type CheckedRoute = { readonly pathname: string; readonly decision?: GateDecision };

type SessionGateProps = {
  readonly sideNavigation: ReactNode;
  readonly children: ReactNode;
  /** Replaced in tests only. */
  readonly api?: SessionApi;
};

/**
 * The back-office route gate (RNX-207), visibility only: the API's AccessGuard stays the source of truth.
 * The session cookies are httpOnly on the API origin, so the gate asks the API (`GET /admin/auth/me`) on every
 * route change, in the browser. /sign-in and /accept-invitation are never gated. No session (the client's
 * refresh failed, as for a suspended admin) goes to sign-in; what else a session reaches is `decideGate`'s.
 * Nothing of a gated route renders until its own answer is in; if the API cannot be asked, nothing renders.
 */
export function SessionGate({ sideNavigation, children, api = defaultSessionApi }: SessionGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  const [checked, setChecked] = useState<CheckedRoute | null>(null);
  useEffect(() => {
    if (isPublic) return;
    let isCurrent = true;
    api.me().then(
      (profile) => isCurrent && setChecked({ pathname, decision: decideGate(profile, pathname) }),
      (err: unknown) => isCurrent && setChecked({ pathname, decision: err instanceof SignedOutError ? { redirectTo: "/sign-in" } : undefined }),
    );
    return () => {
      isCurrent = false;
    };
  }, [api, pathname, isPublic]);
  const current = checked?.pathname === pathname ? checked : null;
  const redirectTo = current?.decision && "redirectTo" in current.decision ? current.decision.redirectTo : null;
  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);
  if (isPublic) return <main className="min-h-screen p-6">{children}</main>;
  if (!current) return <p className="p-6 text-sm text-neutral-600">Checking your session…</p>;
  if (!current.decision) return <p role="alert" className="p-6 text-sm text-red-700">Your session could not be checked. Reload the page to try again.</p>;
  if ("redirectTo" in current.decision) return null;
  if (!current.decision.showsNavigation) return <main className="min-h-screen p-6">{children}</main>;
  return (
    <div className="flex min-h-screen">
      {sideNavigation}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
