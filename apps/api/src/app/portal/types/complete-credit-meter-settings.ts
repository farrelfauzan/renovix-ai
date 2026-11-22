import type { CreditMeterSettings } from "./credit-meter-settings";

/** RNX-329: the credit meter settings when every one is set; the run-out warning check runs only then. */
export type CompleteCreditMeterSettings = { readonly [K in keyof CreditMeterSettings]: NonNullable<CreditMeterSettings[K]> };
