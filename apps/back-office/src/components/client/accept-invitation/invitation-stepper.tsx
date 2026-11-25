"use client";

import { Check } from "lucide-react";

/** The steps of completing an invitation, in order (RNX-333); the last one is the overview the admin lands on. */
const STEPS = ["Password", "Authenticator", "Recovery codes", "Overview"] as const;

/**
 * Where the invitee is in the setup (RNX-333), as the Invite artboard's header draws it: done steps with a tick,
 * the current one filled, the upcoming ones outlined. `current` is the index in STEPS.
 */
export function InvitationStepper({ current }: { current: number }) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex flex-wrap gap-x-[18px] gap-y-2">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === current ? "step" : undefined} className={`flex items-center gap-2 text-[13px] ${index === current ? "text-rx-white" : "text-rx-dark-muted"}`}>
            <span className={`inline-flex size-[26px] items-center justify-center rounded-full border text-xs font-semibold ${index < current ? "border-rx-dark-accent-tint bg-rx-dark-accent-tint text-rx-dark-accent" : index === current ? "border-rx-accent bg-rx-accent text-rx-white" : "border-rx-dark-line text-rx-dark-muted"}`}>
              {index < current ? <Check role="img" aria-label="done" className="size-3.5" /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </nav>
  );
}
