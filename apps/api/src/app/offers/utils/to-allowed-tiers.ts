import { MODEL_TIERS } from "../config/model-tiers";

/**
 * The model tiers an account may use (RNX-76 B2, Q1, D111): its packages' tiers plus the cheapest tier, which every
 * account keeps; in MODEL_TIERS order, names outside MODEL_TIERS dropped.
 */
export const toAllowedTiers = (packageTiers: readonly string[]): string[] =>
  MODEL_TIERS.filter((tier) => tier === MODEL_TIERS[0] || packageTiers.includes(tier));
