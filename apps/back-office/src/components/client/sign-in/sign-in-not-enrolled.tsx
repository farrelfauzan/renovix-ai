"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";

type SignInNotEnrolledProps = {
  readonly isSubmitting: boolean;
  /** Sends the sign-in with email and password only; the API answers an admin without TOTP with an enrolment session. */
  readonly onContinue: () => void;
  readonly onBack: () => void;
};

/** The canvas's "MFA not enrolled yet" state (RNX-332): shown on the admin's own word, nothing is sent until "Continue to enrolment". */
export function SignInNotEnrolled({ isSubmitting, onContinue, onBack }: SignInNotEnrolledProps) {
  return (
    <div className="flex flex-col gap-[18px]">
      <h1 className="text-[22px] font-bold tracking-[-0.01em]">MFA not enrolled yet</h1>
      <p className="flex items-start gap-2.5 rounded-rx bg-rx-accent-tint px-3 py-2.5 text-[13px] text-rx-accent-hover">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-rx-accent" />
        Set up your authenticator before anything else loads.
      </p>
      <Button type="button" disabled={isSubmitting} onClick={onContinue} className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
        Continue to enrolment
      </Button>
      <Button variant="link" type="button" onClick={onBack} className="h-auto min-h-11 self-start p-0 text-[13px] font-normal whitespace-normal text-rx-accent hover:text-rx-accent-hover">
        Back to the code
      </Button>
    </div>
  );
}
