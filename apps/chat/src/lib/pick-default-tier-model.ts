import type { MyEntitlements } from "@/hooks/use-my-entitlements";
import type { PortalModel } from "@/hooks/use-portal";
import { isModelLocked } from "@/lib/model-lock";

/**
 * RNX-77a: the model a new chat starts on: the first unlocked model of the user's default tier, or, when that tier is
 * locked (for example after a downgrade) or has no model, the first unlocked model.
 */
export function pickDefaultTierModel({
  models,
  entitlements,
  defaultTier,
}: {
  models: readonly PortalModel[];
  entitlements: MyEntitlements | undefined;
  defaultTier: string;
}): string | null {
  const unlocked = models.filter((model) => !isModelLocked(model, entitlements));
  return (unlocked.find((model) => model.tier === defaultTier) ?? unlocked[0])?.slug ?? null;
}
