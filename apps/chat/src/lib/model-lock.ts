import type { MyEntitlements } from "@/hooks/use-my-entitlements";
import type { PortalModel } from "@/hooks/use-portal";

/** True when the user's package does not include the model's tier. Unknown entitlements never lock. */
export function isModelLocked(model: PortalModel, entitlements: MyEntitlements | undefined): boolean {
  if (!entitlements || !model.tier) return false;
  return !entitlements.tiers.includes(model.tier);
}
