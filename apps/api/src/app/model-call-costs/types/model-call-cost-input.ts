import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { UsageRecord } from "../../billing/types/usage-record";

/** RNX-162: one model call to cost: its usage entry as written (wallet, call id) and the record it was written from. */
export type ModelCallCostInput = {
  readonly entry: CreditLedgerEntry;
  readonly record: UsageRecord;
};
