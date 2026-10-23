import type { ProviderReconciliationEntry } from "@generated/prisma/client.js";
import type { UsageSumRow } from "./usage-sum-row";

/** What one reconciliation row is built from (RNX-228): the day's entry, the previous day's, our estimate and the threshold. */
export type ReconciliationRowInput = {
  readonly entry: ProviderReconciliationEntry;
  readonly previous: ProviderReconciliationEntry | undefined;
  readonly estimate: UsageSumRow | undefined;
  readonly thresholdPercent: number | null;
};
