import { MODEL_TIERS } from "../../offers/config/model-tiers";

/**
 * RNX-179 (D149): whether `tier` is above `ceiling` in MODEL_TIERS order. A fallback model must not be: its tier is
 * the model's or a lower one. A tier outside MODEL_TIERS ranks below every listed tier.
 */
export const isTierAbove = (tier: string, ceiling: string): boolean =>
  (MODEL_TIERS as readonly string[]).indexOf(tier) > (MODEL_TIERS as readonly string[]).indexOf(ceiling);
