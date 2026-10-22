import type { CreditAdjustmentInput } from "./credit-adjustment-input";

/** The built request, or the text to show when a field is wrong. */
export type CreditAdjustmentInputResult = { readonly input: CreditAdjustmentInput } | { readonly error: string };
