/**
 * The typed upstream errors (D199, RNX-190): 401 or 403 → unauthorized; 400, 404 or 422 about the model → model not
 * found; no answer in time → timeout; anything else → unavailable.
 */
export type ProviderErrorKind = "unauthorized" | "model_not_found" | "timeout" | "unavailable";
