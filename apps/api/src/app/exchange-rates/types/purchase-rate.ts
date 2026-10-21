import type { Decimal } from "@prisma/client/runtime/client";

/** The USD to IDR rate a purchase is charged at (RNX-53): copied onto its purchase snapshot. */
export type PurchaseRate = {
  readonly rate: Decimal;
  readonly rateDate: Date;
  readonly source: string;
};
