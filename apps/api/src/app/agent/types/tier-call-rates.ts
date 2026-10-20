import type { CallRates } from "../../billing/types/call-rates";

/** A model's tier and that tier's rates, as a usage entry copies them (docs/credits.md section 2.1). */
export type TierCallRates = {
  readonly tier: string;
  readonly rates: CallRates;
};
