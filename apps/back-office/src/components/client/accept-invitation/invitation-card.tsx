"use client";

import type { ReactNode } from "react";

/** One white card of the invitation on the dark page, as the canvas's Invite artboard draws them (RNX-333). */
export function InvitationCard({ children }: { children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-4 rounded-rx bg-rx-white p-6 text-rx-ink narrow:p-4">{children}</section>;
}
