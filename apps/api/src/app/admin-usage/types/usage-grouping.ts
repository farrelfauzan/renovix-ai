import type { USAGE_GROUPINGS } from "../config/usage-groupings";

/** The columns one report sums the usage rows by: one of the fixed groupings (RNX-228). */
export type UsageGrouping = (typeof USAGE_GROUPINGS)[keyof typeof USAGE_GROUPINGS];
