import type { MyEntitlements } from "@/hooks/use-my-entitlements";

/** The text shown next to a locked model. */
export function getModelLockLabel(entitlements: MyEntitlements): string {
  return entitlements.nextPackage ? `Available on ${entitlements.nextPackage}` : "Not in your package";
}
