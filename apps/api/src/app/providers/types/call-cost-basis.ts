import type { Decimal } from "@prisma/client/runtime/client";

/**
 * RNX-162: what one call to a model on its provider record costs us, from ModelRegistryService's cache: the model's
 * USD prices per token (RX-21; no cached price yet is null) and the provider record's cost settings (each null when
 * off).
 */
export interface CallCostBasis {
  readonly providerRecordId: string;
  readonly inputPrice: Decimal;
  readonly cachedInputPrice: Decimal | null;
  readonly outputPrice: Decimal;
  readonly costMultiplier: Decimal | null;
  readonly perCallFloorUsd: Decimal | null;
  readonly highCaseFactor: Decimal | null;
  readonly highCaseTokenThreshold: number | null;
}
