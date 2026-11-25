"use client";

import type { ReactNode } from "react";
import { InvitationStepper } from "./invitation-stepper";
import { LinkExpiry } from "./link-expiry";

type AcceptInvitationHeaderProps = {
  /** The brand mark, rendered by the page (a server component). */
  readonly logo?: ReactNode;
  /** The current step's index, or null when no step is in progress (checking the link, or a link that cannot be used). */
  readonly step: number | null;
  /** The preview's expiry, while the link is still unused (the password step). */
  readonly expiresAt: string | null;
};

/**
 * The invitation's brand row on the dark page, as the Invite artboard draws it (RNX-333): the logo, "set up your
 * account", the link's time left while it is unused, and the stepper.
 */
export function AcceptInvitationHeader({ logo, step, expiresAt }: AcceptInvitationHeaderProps) {
  return (
    <header className="flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-4">
      <span className="flex items-center gap-2.5">
        {logo}
        <span className="flex flex-col">
          <span className="text-base font-bold text-rx-white">Renovix Admin · set up your account</span>
          {expiresAt && <LinkExpiry expiresAt={expiresAt} />}
        </span>
      </span>
      {step !== null && <InvitationStepper current={step} />}
    </header>
  );
}
