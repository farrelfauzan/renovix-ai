import type { ServedBy } from "./served-by";

/**
 * RNX-179: what ProviderRouter tells the caller about one chat call's attempts (the requested model, then its fallbacks).
 */
export interface CallHooks {
  /** Before each attempt: the model and provider about to be called. The last one is the one that served or failed. */
  readonly onAttempt?: (candidate: ServedBy) => void;
  /**
   * An attempt that failed with a 502 or 503 and moves on to the next fallback (docs/credits.md section 3.1 rule 6:
   * its own model call, a provider_error usage entry). Awaited before the next attempt. The last attempt's error is
   * thrown to the caller instead.
   */
  readonly onAttemptFailed?: (failed: ServedBy, error: unknown) => void | Promise<void>;
}
