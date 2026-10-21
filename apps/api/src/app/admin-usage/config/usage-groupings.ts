/**
 * The dimensions each report sums the usage rows by (RNX-228). Every name is a column of usage_daily_rollups (and of
 * the live query, which has the same columns); the repository only ever puts these fixed names into SQL.
 */
export const USAGE_GROUPINGS = {
  /** Token counts and calls: no cost, no revenue (usage:read). */
  usage: ["day", "provider_id", "provider_model_id", "tier", "workspace_id", "user_id"],
  /** Cost, revenue, profit and margin (profit:read). */
  profit: ["day", "provider_id", "provider_model_id", "tier", "wallet", "package_version_id", "top_up_pack_version_id"],
  /** Our cost estimate of one provider record on one day (reconciliation). */
  reconciliation: ["day", "provider_id"],
} as const;
