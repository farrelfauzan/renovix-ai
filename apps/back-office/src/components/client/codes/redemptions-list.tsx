"use client";

import type { CodeRedemption } from "@/lib/codes/code-redemption";

/** Who redeemed a code, newest first (user id, when, what it granted). */
export function RedemptionsList({ redemptions }: { redemptions: readonly CodeRedemption[] }) {
  if (redemptions.length === 0) return <p className="text-sm text-rx-muted">Not redeemed yet.</p>;
  return (
    <ul aria-label="Redemptions" className="flex flex-col gap-1 text-sm">
      {redemptions.map((entry) => (
        <li key={entry.id}>
          {new Date(entry.redeemedAt).toLocaleString("en-GB")} · user {entry.userId} ·{" "}
          {[entry.creditsGranted && `${Number(entry.creditsGranted)} credits`, entry.planGranted && `plan ${entry.planGranted}`, entry.daysGranted && `${entry.daysGranted} days`].filter(Boolean).join(", ")}
        </li>
      ))}
    </ul>
  );
}
