import type { PurchaseRate } from "../../exchange-rates/types/purchase-rate";
import type { CallCostSource } from "../../billing/types/call-cost-source";
import type { ModelCallCostInput } from "./model-call-cost-input";

/** RNX-162: a call to cost, its cost source, and the usable USD to IDR rate (null when none). */
export type ModelCallCostRowInput = ModelCallCostInput & {
  readonly source: CallCostSource;
  readonly rate: PurchaseRate | null;
};
