import type { MyEntitlements } from "@/hooks/use-my-entitlements";
import { getModelLockLabel } from "@/lib/get-model-lock-label";

/**
 * RNX-77a: the default-tier choices of Settings > General: the tiers the packages allow, then the locked ones,
 * disabled and labelled with the package that grants them.
 */
export function buildTierOptions(entitlements: MyEntitlements): { value: string; label: string; disabled: boolean }[] {
  const toLabel = (tier: string): string => tier.charAt(0).toUpperCase() + tier.slice(1);
  const allowed = entitlements.tiers.map((tier) => ({ value: tier, label: toLabel(tier), disabled: false }));
  const locked = entitlements.lockedTiers.map(({ tier }) => ({
    value: tier,
    label: `${toLabel(tier)} · ${getModelLockLabel(entitlements, tier)}`,
    disabled: true,
  }));
  return [...allowed, ...locked];
}
