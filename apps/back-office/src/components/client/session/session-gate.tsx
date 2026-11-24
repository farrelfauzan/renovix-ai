"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SignedOutError } from "@/lib/api/signed-out-error";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { decideGate } from "@/lib/session/decide-gate";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { GateDecision } from "@/lib/session/gate-decision";
import { isPublicPath } from "@/lib/session/is-public-path";
import type { SessionApi } from "@/lib/session/session-api";
import { SignedInAdminContext } from "@/lib/session/signed-in-admin-context";

/** The answer for one route; no decision: the session could not be checked. */
type CheckedRoute = { readonly pathname: string; readonly decision?: GateDecision; readonly profile?: AdminProfile };

type SessionGateProps = {
  readonly sideNavigation: ReactNode;
  /** The brand block above the public screens (sign-in, accept-invitation). */
  readonly publicHeader: ReactNode;
  readonly children: ReactNode;
  /** Replaced in tests only. */
  readonly api?: SessionApi;
};

/**
 * The back-office route gate (RNX-207), visibility only: the API's AccessGuard stays the source of truth.
 * The session cookies are httpOnly on the API origin, so the gate asks the API (`GET /admin/auth/me`) on every
 * route change, in the browser. /sign-in and /accept-invitation are never gated; they render in one white card on
 * the dark page, under the brand row (RNX-332). No session (the client's
 * refresh failed, as for a suspended admin) goes to sign-in; what else a session reaches is `decideGate`'s.
 * Nothing of a gated route renders until its own answer is in; if the API cannot be asked, nothing renders.
 * The shell around a route reads that answer's profile from SignedInAdminContext (RNX-312a): no other /me call.
 * The gate lives in the root layout, so its last answer outlives a client navigation. A public route drops it
 * (RNX-286): the answer from before a sign-in ("no session: go to sign-in") must not decide the route after it.
 */
export function SessionGate({ sideNavigation, publicHeader, children, api = defaultSessionApi }: SessionGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  const [checked, setChecked] = useState<CheckedRoute | null>(null);
  useEffect(() => {
    if (isPublic) {
      setChecked(null);
      return;
    }
    let isCurrent = true;
    api.me().then(
      (profile) => isCurrent && setChecked({ pathname, decision: decideGate(profile, pathname), profile }),
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
  if (isPublic) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-7 bg-rx-dark-ground px-8 py-10 narrow:px-4 narrow:py-6">
        <header className="w-full max-w-[1180px]">{publicHeader}</header>
        <div className="w-full max-w-[400px] rounded-rx bg-rx-white p-7 text-rx-ink narrow:p-4">{children}</div>
      </main>
    );
  }
  if (!current) return <p className="p-6 text-sm text-rx-muted">Checking your session…</p>;
  if (!current.decision) return <p role="alert" className="p-6 text-sm text-rx-red-bar">Your session could not be checked. Reload the page to try again.</p>;
  if ("redirectTo" in current.decision) return null;
  if (!current.decision.showsNavigation) return <main className="min-h-screen p-6">{children}</main>;
  return (
    <SignedInAdminContext value={current.profile ?? null}>
      <div className="flex min-h-screen flex-row narrow:flex-col">
        {sideNavigation}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </SignedInAdminContext>
  );
}
