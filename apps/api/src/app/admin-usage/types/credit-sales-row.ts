import type { Decimal } from "@prisma/client/runtime/client";

/** Credits sold on one day for one package or top-up pack version (RNX-228), valued at the snapshots' list prices. */
export type CreditSalesRow = {
  /** YYYY-MM-DD, Asia/Jakarta. */
  readonly day: string;
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
  readonly entries: number;
  readonly creditsSold: Decimal;
  readonly listValueIdr: Decimal;
  readonly listValueUsd: Decimal;
};
