import type { ChatUsage } from "../../providers/provider.interface";
import type { ServedBy } from "../../providers/types/served-by";

/**
 * RNX-162: what a usage entry's model_call_costs row is written from, besides the entry: the model and provider record
 * that served (or failed) the call with its cost basis, the provider's usage report (its reported cost and reasoning
 * tokens; absent when none arrived) and the agent run's workspace (absent on a path without one).
 */
export type CallCostSource = {
  readonly servedBy: ServedBy;
  readonly usage?: ChatUsage;
  readonly workspaceId?: string;
};
