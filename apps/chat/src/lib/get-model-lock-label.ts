import type { MyEntitlements } from "@/hooks/use-my-entitlements";

/** The text shown next to a locked model: the next package that grants the model's tier, if any. */
export function getModelLockLabel(entitlements: MyEntitlements, tier: string): string {
  const nextPackage = entitlements.lockedTiers.find((locked) => locked.tier === tier)?.nextPackage;
  return nextPackage ? `Available on ${nextPackage}` : "Not in your package";
}
