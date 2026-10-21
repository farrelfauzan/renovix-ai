import type { Decimal } from "@prisma/client/runtime/client";
import type { CallTokens } from "../../billing/types/call-tokens";
import type { CallCostBasis } from "../../providers/types/call-cost-basis";

/**
 * RNX-162: what computeCallCost prices one call from: its tokens, the provider's reported cost in USD (null when none),
 * the model's prices and provider settings (null when unknown) and the USD to IDR rate (null when none is usable).
 */
export type CallCostInput = {
  readonly tokens: CallTokens;
  readonly reportedCostUsd: Decimal | null;
  readonly basis: CallCostBasis | null;
  readonly rate: Decimal | null;
};
