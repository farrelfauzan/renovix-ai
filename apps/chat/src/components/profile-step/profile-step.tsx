"use client";

import { Loader2 } from "lucide-react";
import { ProfileStepForm } from "@/components/profile-step/profile-step-form";
import { useCurrentUser } from "@/hooks/use-current-user";

/** RNX-33: loads the signed-in user, then shows the profile step prefilled with what the account already has. */
export function ProfileStep() {
  const { data: user } = useCurrentUser();
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  return <ProfileStepForm user={user} />;
}
