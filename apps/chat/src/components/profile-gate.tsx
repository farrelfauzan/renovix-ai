"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isProfileGateExempt } from "@/lib/is-profile-gate-exempt";
import { PROFILE_STEP_PATH } from "@/lib/profile-step-path";
import { useAuthStore, useHydrated } from "@/lib/stores";

/**
 * RNX-33: sends a signed-in user whose profile is not complete to the profile step from every app route, with the
 * requested page as `redirect`, and renders no app content for them until the step is saved. The session cookie
 * carries no profile claim (it is Better Auth's opaque token), so the gate reads the current user through the API
 * client here instead of in proxy.ts. The profile step and the sign-in routes are exempt; anonymous visitors pass.
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const { data: user, isError } = useCurrentUser();
  const isExempt = isProfileGateExempt(pathname);
  const isSignedIn = hydrated && isLoggedIn();
  const mustCompleteProfile = !isExempt && isSignedIn && user?.profileCompleted === false;

  useEffect(() => {
    if (!mustCompleteProfile) return;
    const requested = `${pathname}${window.location.search}`;
    router.replace(`${PROFILE_STEP_PATH}?redirect=${encodeURIComponent(requested)}`);
  }, [mustCompleteProfile, pathname, router]);

  if (isExempt) return <>{children}</>;
  if (hydrated && !isSignedIn) return <>{children}</>;
  // The API is the authority: when the profile cannot be read (an expired session), the gate does not block.
  if (isError) return <>{children}</>;
  if (user?.profileCompleted) return <>{children}</>;
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}
