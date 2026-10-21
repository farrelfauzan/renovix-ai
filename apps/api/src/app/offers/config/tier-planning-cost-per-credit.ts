import type { MODEL_TIERS } from "./model-tiers";

/**
 * The planning cost per credit of each tier in MODEL_TIERS (RNX-185, D237, docs/credits.md section 14.5), in dollars:
 * the daily price refresh alerts when a model's cost per credit at the token mix is above its tier's value. No
 * default: a model tier outside this table gets no planning check and the job logs an error naming the tier.
 */
export const TIER_PLANNING_COST_PER_CREDIT: Readonly<Record<(typeof MODEL_TIERS)[number], string>> = {
  standard: "0.14",
  advanced: "0.14",
  premium: "0.14",
  frontier: "0.14",
};
