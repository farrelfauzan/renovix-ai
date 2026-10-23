import type { UsageMeasures } from "./usage-measures";

/**
 * One summed row of the usage aggregates (RNX-228). The day is always there; each other dimension only when the
 * report's grouping has it.
 */
export type UsageSumRow = UsageMeasures & {
  /** YYYY-MM-DD, Asia/Jakarta. */
  readonly day: string;
  readonly providerId?: string | null;
  readonly providerModelId?: string;
  readonly tier?: string;
  readonly wallet?: string;
  readonly workspaceId?: string | null;
  readonly userId?: string | null;
  readonly packageVersionId?: string | null;
  readonly topUpPackVersionId?: string | null;
};
