import type { CallCostBasis } from "./call-cost-basis";

/** RNX-179: the model and provider record that answered a chat call (the requested one, or a fallback). */
export interface ServedBy {
  readonly slug: string;
  readonly providerName: string;
  /** RNX-162: its connection's cost basis, when it has one (what the call's model_call_costs row is priced from). */
  readonly costBasis?: CallCostBasis;
}
