/** The one model tier whose home-chat calls spend the weekly_free wallet (D5, docs/credits.md section 6). */
const WEEKLY_FREE_TIER = "standard";

/** RNX-58a: whether a home-chat call on a model of this tier spends weekly_free credits before paid ones. */
export function isWeeklyFreeTier(tier: string): boolean {
  return tier === WEEKLY_FREE_TIER;
}
