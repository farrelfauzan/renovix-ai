import type { Decimal } from "@prisma/client/runtime/client";

/** One portal balance to store (RNX-228): the provider record, the day (YYYY-MM-DD), the amounts in USD and the admin. */
export type ReconciliationEntryInput = {
  readonly providerId: string;
  readonly day: string;
  readonly portalBalanceUsd: Decimal;
  readonly topUpUsd: Decimal;
  readonly adminId: string;
};
