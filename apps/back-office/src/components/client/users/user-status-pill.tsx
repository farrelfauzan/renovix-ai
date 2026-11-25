"use client";

import type { UserStatus } from "@/lib/users/user-status";

/** The tag colours of each status, from the shared tokens (the design canvas's pills). */
const TONE: Record<UserStatus, string> = {
  active: "bg-rx-green-tint text-rx-green",
  suspended: "bg-rx-tag text-rx-tag-text",
  locked: "bg-rx-red-tint text-rx-red-text",
};

/** A user's status as a pill: active, suspended or locked (no available credits). */
export function UserStatusPill({ status }: { readonly status: UserStatus }) {
  return <span className={`whitespace-nowrap rounded-rx-pill px-2 py-0.5 font-mono text-[11px] tracking-[0.05em] uppercase ${TONE[status]}`}>{status}</span>;
}
